/**
 * scripts/dev-db.mjs
 *
 * Arranca un servidor PostgreSQL embebido en local (sin instalación del sistema),
 * aplica las migraciones de Drizzle y hace seed del usuario de prueba.
 *
 * Uso:
 *   node --env-file=apps/web/.env.local scripts/dev-db.mjs
 *
 * Una vez terminado, actualiza DATABASE_URL en .env.local a:
 *   postgres://pradomotica:pradomotica@localhost:15432/pradomotica
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, access, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { platform } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '.postgres-data');

await mkdir(dataDir, { recursive: true });

const PG_PORT = 15432;
const PG_USER = 'pradomotica';
const PG_PASSWORD = 'pradomotica';
const PG_DB = 'pradomotica';
const CONNECTION_URL = `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`;

async function removeStalePostmasterPid() {
  const pidFile = join(dataDir, 'postmaster.pid');
  try {
    const contents = await readFile(pidFile, 'utf8');
    const pid = Number(contents.split('\n')[0]?.trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        // El proceso sigue vivo → matarlo para liberar la memoria compartida
        console.log(`⚠ Proceso PostgreSQL ${pid} aún activo. Terminando...`);
        if (platform === 'win32') {
          execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGKILL');
        }
        // Esperar a que el proceso libere los recursos
        await new Promise((r) => setTimeout(r, 1500));
      } catch {
        // El proceso ya no existe, solo limpiar el fichero
        console.log(`⚠ Lock file obsoleto para PID ${pid}, eliminando...`);
      }
    } else {
      console.log('⚠ Lock file de PostgreSQL obsoleto, eliminando...');
    }
    await rm(pidFile, { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function killAllPostgresProcesses() {
  if (platform !== 'win32') return;
  try {
    execSync('taskkill /F /IM postgres.exe /T', { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
  } catch {
    // No había procesos — ignorar
  }
}

// --- Arrancar Postgres embebido ---
const { default: EmbeddedPostgres } = await import('embedded-postgres');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: PG_USER,
  password: PG_PASSWORD,
  port: PG_PORT,
  persistent: true,
});

console.log('🐘 Iniciando PostgreSQL embebido...');

// Si ya está inicializado (directorio con PG_VERSION existe), solo arrancar.
const pgVersion = join(dataDir, 'PG_VERSION');
const alreadyInitialised = await access(pgVersion).then(() => true).catch(() => false);

if (!alreadyInitialised) {
  await pg.initialise();
} else {
  await killAllPostgresProcesses();
  await removeStalePostmasterPid();
}

try {
  await pg.start();
} catch (error) {
  const msg = String(error);
  if (msg.includes('postmaster.pid') || msg.includes('shared memory')) {
    console.log('⚠ Fallo al arrancar Postgres. Limpiando procesos y reintentando...');
    await killAllPostgresProcesses();
    await removeStalePostmasterPid();
    await pg.start();
  } else {
    throw error;
  }
}

if (!alreadyInitialised) {
  await pg.createDatabase(PG_DB);
}

console.log(`✅ PostgreSQL corriendo en puerto ${PG_PORT}`);
console.log(`   URL: ${CONNECTION_URL}`);

// --- Ejecutar migraciones leyendo los SQL directamente ---
process.env.DATABASE_URL = CONNECTION_URL;

const { default: postgresForMigrate } = await import('postgres');
const { readdir, readFile: readMigrationFile } = await import('node:fs/promises');
const { join: pathJoin } = await import('node:path');

const migrationsFolder = join(__dirname, '..', 'packages', 'db', 'drizzle');
const migClient = postgresForMigrate(CONNECTION_URL, { max: 1 });

console.log('\n📦 Aplicando migraciones...');

// Tabla de control de migraciones aplicadas
await migClient`
  CREATE TABLE IF NOT EXISTS drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash TEXT NOT NULL,
    created_at BIGINT
  )
`;

const applied = new Set(
  (await migClient`SELECT hash FROM drizzle_migrations`).map((r) => r.hash),
);

const files = (await readdir(migrationsFolder))
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const hash = file.replace('.sql', '');
  if (applied.has(hash)) continue;
  const sql = await readMigrationFile(pathJoin(migrationsFolder, file), 'utf8');
  // Drizzle separa los statements con --> statement-breakpoint
  const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await migClient.unsafe(stmt);
  }
  await migClient`INSERT INTO drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
  console.log(`  ✓ ${file}`);
}

await migClient.end();
console.log('✅ Migraciones aplicadas.');

// --- Seed usuario de prueba ---
const TEST_EMAIL = 'test@pradomotica.local';
const TEST_PASSWORD = 'Test1234!';
const TEST_NAME = 'Usuario de prueba';

function newId() {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

const seedClient = postgresForMigrate(CONNECTION_URL, { max: 1 });

const [existing] = await seedClient`SELECT id FROM users WHERE email = ${TEST_EMAIL} LIMIT 1`;

if (existing) {
  console.log(`\n✅ Usuario de prueba ya existe: ${TEST_EMAIL}`);
} else {
  const { default: argon2 } = await import('argon2');
  const passwordHash = await argon2.hash(TEST_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const userId = newId();
  const householdId = newId();
  const now = new Date();

  await seedClient.begin(async (tx) => {
    await tx`
      INSERT INTO users (id, email, password_hash, display_name, email_verified_at, created_at, updated_at)
      VALUES (${userId}, ${TEST_EMAIL}, ${passwordHash}, ${TEST_NAME}, ${now}, ${now}, ${now})
    `;
    await tx`
      INSERT INTO households (id, name, owner_id, created_at, updated_at)
      VALUES (${householdId}, ${'Casa de prueba'}, ${userId}, ${now}, ${now})
    `;
    await tx`
      INSERT INTO household_members (household_id, user_id, role, invited_at, joined_at)
      VALUES (${householdId}, ${userId}, ${'owner'}, ${now}, ${now})
    `;
  });

  console.log('\n✅ Usuario de prueba creado:');
  console.log(`   Email:    ${TEST_EMAIL}`);
  console.log(`   Password: ${TEST_PASSWORD}`);
}

await seedClient.end();

console.log('\n───────────────────────────────────────────────');
console.log('Añade/actualiza esta línea en apps/web/.env.local:');
console.log(`DATABASE_URL=${CONNECTION_URL}`);
console.log('───────────────────────────────────────────────');
console.log('\n🟢 PostgreSQL sigue corriendo. Pulsa Ctrl+C para detener.\n');

// Mantener el proceso vivo mientras se desarrolla.
process.on('SIGINT', async () => {
  console.log('\n🛑 Deteniendo PostgreSQL...');
  await pg.stop();
  process.exit(0);
});

await new Promise(() => {}); // espera infinita
