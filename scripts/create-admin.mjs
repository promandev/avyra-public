#!/usr/bin/env node
/**
 * Crea un usuario administrador con credenciales reales.
 *
 * Uso:
 *   node --env-file=apps/web/.env.local scripts/create-admin.mjs \
 *     --email tu@email.com \
 *     --name "Tu Nombre" \
 *     --password "TuPassword123!" \
 *     [--household "Nombre de tu casa"]
 *
 * Si no se pasan los flags, el script los solicita de forma interactiva.
 * Si ya existe un usuario con ese email, el script se detiene sin modificar nada.
 */

import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, access, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { platform } from 'node:process';
import { createInterface } from 'node:readline';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Arrancar postgres embebido si no hay nadie escuchando en 15432 ──────────

const PG_PORT = 15432;
const PG_USER = 'pradomotica';
const PG_PASSWORD = 'pradomotica';
const PG_DB = 'pradomotica';
const dataDir = join(__dirname, '..', '.postgres-data');

async function isPostgresRunning() {
  const testSql = postgres(
    `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`,
    { max: 1, connect_timeout: 2 },
  );
  try {
    await testSql`SELECT 1`;
    await testSql.end();
    return true;
  } catch {
    await testSql.end().catch(() => {});
    return false;
  }
}

async function killAllPostgresProcesses() {
  if (platform !== 'win32') return;
  try { execSync('taskkill /F /IM postgres.exe /T', { stdio: 'ignore' }); } catch { /* none */ }
  await new Promise((r) => setTimeout(r, 1500));
}

async function removeStalePostmasterPid() {
  const pidFile = join(dataDir, 'postmaster.pid');
  try {
    const contents = await readFile(pidFile, 'utf8');
    const pid = Number(contents.split('\n')[0]?.trim());
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch { /* already dead */ }
      if (platform === 'win32') {
        try { execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' }); } catch { /* ok */ }
      } else {
        try { process.kill(pid, 'SIGKILL'); } catch { /* ok */ }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await rm(pidFile, { force: true });
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

let pgInstance = null;

async function ensurePostgresRunning() {
  if (await isPostgresRunning()) return; // ya está corriendo

  console.log('🐘 Arrancando PostgreSQL embebido...');
  await mkdir(dataDir, { recursive: true });

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  pgInstance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
  });

  const pgVersion = join(dataDir, 'PG_VERSION');
  const alreadyInitialised = await access(pgVersion).then(() => true).catch(() => false);

  if (!alreadyInitialised) {
    await pgInstance.initialise();
  } else {
    await killAllPostgresProcesses();
    await removeStalePostmasterPid();
  }

  try {
    await pgInstance.start();
  } catch (error) {
    const msg = String(error);
    if (msg.includes('postmaster.pid') || msg.includes('shared memory')) {
      await killAllPostgresProcesses();
      await removeStalePostmasterPid();
      await pgInstance.start();
    } else {
      throw error;
    }
  }

  if (!alreadyInitialised) {
    await pgInstance.createDatabase(PG_DB);
  }

  console.log(`✅ PostgreSQL corriendo en localhost:${PG_PORT}`);
}

await ensurePostgresRunning();

// ─── Parse args ──────────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  options: {
    email:      { type: 'string' },
    name:       { type: 'string' },
    password:   { type: 'string' },
    household:  { type: 'string' },
  },
  strict: false,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function newId() {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

async function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function isStrongPassword(pw) {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL no definida.');
  console.error('Ejecuta: node --env-file=apps/web/.env.local scripts/create-admin.mjs');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

let email     = flags.email?.trim();
let name      = flags.name?.trim();
let password  = flags.password;
let household = flags.household?.trim();

// Solicitar datos que falten de forma interactiva
if (!email) {
  email = (await prompt(rl, 'Email: ')).trim();
}
if (!name) {
  name = (await prompt(rl, 'Nombre para mostrar: ')).trim();
}
if (!password) {
  // readline no oculta la contraseña en Node, pero es uso local
  password = (await prompt(rl, 'Contraseña (mín. 8 chars, 1 mayúscula, 1 número): ')).trim();
}
if (!household) {
  const defaultHousehold = `Casa de ${name.split(' ')[0]}`;
  const answer = (await prompt(rl, `Nombre del hogar [${defaultHousehold}]: `)).trim();
  household = answer || defaultHousehold;
}

rl.close();

// ─── Validaciones ────────────────────────────────────────────────────────────

if (!email.includes('@')) {
  console.error('ERROR: Email inválido.');
  process.exit(1);
}
if (name.length < 2) {
  console.error('ERROR: El nombre debe tener al menos 2 caracteres.');
  process.exit(1);
}
if (!isStrongPassword(password)) {
  console.error('ERROR: La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.');
  process.exit(1);
}

// ─── Aplicar migraciones pendientes ──────────────────────────────────────────

const { readdir, readFile: readMigrationFile } = await import('node:fs/promises');

const migrationsFolder = join(__dirname, '..', 'packages', 'db', 'drizzle');
const migSql = postgres(url, { max: 1 });

await migSql`
  CREATE TABLE IF NOT EXISTS drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash TEXT NOT NULL,
    created_at BIGINT
  )
`;
const applied = new Set(
  (await migSql`SELECT hash FROM drizzle_migrations`).map((r) => r.hash),
);
const migFiles = (await readdir(migrationsFolder)).filter((f) => f.endsWith('.sql')).sort();
for (const file of migFiles) {
  const hash = file.replace('.sql', '');
  if (applied.has(hash)) continue;
  const migSqlText = await readMigrationFile(join(migrationsFolder, file), 'utf8');
  const statements = migSqlText.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) await migSql.unsafe(stmt);
  await migSql`INSERT INTO drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
  console.log(`  ✓ migración aplicada: ${file}`);
}
await migSql.end();

// ─── Conexión y creación ──────────────────────────────────────────────────────

const { default: argon2 } = await import('argon2');
const sql = postgres(url, { max: 1 });

// Comprobar si ya existe
const [existing] = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()} LIMIT 1`;
if (existing) {
  console.log(`\nℹ️  Ya existe un usuario con el email: ${email}`);
  console.log('   No se ha modificado nada. Si quieres reasignar datos, usa:');
  console.log('   node --env-file=apps/web/.env.local scripts/migrate-household.mjs');
  await sql.end();
  if (pgInstance) await pgInstance.stop();
  process.exit(0);
}

const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
});

const userId      = newId();
const householdId = newId();
const now         = new Date();

await sql.begin(async (tx) => {
  await tx`
    INSERT INTO users (id, email, password_hash, display_name, email_verified_at, created_at, updated_at)
    VALUES (${userId}, ${email.toLowerCase()}, ${passwordHash}, ${name}, ${now}, ${now}, ${now})
  `;

  await tx`
    INSERT INTO households (id, name, owner_id, created_at, updated_at)
    VALUES (${householdId}, ${household}, ${userId}, ${now}, ${now})
  `;

  await tx`
    INSERT INTO household_members (household_id, user_id, role, invited_at, joined_at)
    VALUES (${householdId}, ${userId}, ${'owner'}, ${now}, ${now})
  `;
});

console.log('\n✅ Usuario administrador creado correctamente.');
console.log(`   Email:   ${email}`);
console.log(`   Nombre:  ${name}`);
console.log(`   Hogar:   ${household}`);
console.log(`   User ID: ${userId}`);
console.log(`   Household ID: ${householdId}`);
console.log('');
console.log('Si tienes dispositivos de un usuario anterior que quieres migrar, ejecuta:');
console.log('   node --env-file=apps/web/.env.local scripts/migrate-household.mjs');

await sql.end();
if (pgInstance) await pgInstance.stop();
