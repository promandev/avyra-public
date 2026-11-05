/**
 * Seed: crea dos usuarios de prueba si no existen.
 * Ejecutar con:  node --env-file=apps/web/.env.local scripts/seed-test-users.mjs
 *
 * Cuentas creadas:
 *   alice@pradomotica.local / Alice1234!  — viewer en el primer hogar existente
 *   bob@pradomotica.local   / Bob1234!    — sin hogar asignado (para probar el flujo)
 *
 * Si ya existen los usuarios, el script los omite sin modificar nada.
 */

import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'ERROR: DATABASE_URL no definida.\nUsa: node --env-file=apps/web/.env.local scripts/seed-test-users.mjs',
  );
  process.exit(1);
}

const { default: argon2 } = await import('argon2');
const client = postgres(url, { max: 1 });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newId() {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('🌱 Seeding test users...\n');

// Get first existing household (to add Alice to it)
const [firstHousehold] = await client`
  SELECT id, name FROM households ORDER BY created_at ASC LIMIT 1
`;

// ── Alice ─────────────────────────────────────────────────────────────────────

const ALICE_EMAIL = 'alice@pradomotica.local';
const ALICE_PASSWORD = 'Alice1234!';
const ALICE_NAME = 'Alice (prueba)';

const [existingAlice] = await client`SELECT id FROM users WHERE email = ${ALICE_EMAIL} LIMIT 1`;

if (existingAlice) {
  console.log(`  ⏭  Alice ya existe (${ALICE_EMAIL})`);
} else {
  const aliceId = newId();
  const now = new Date();
  const hash = await hashPassword(ALICE_PASSWORD);

  await client.begin(async (tx) => {
    await tx`
      INSERT INTO users (id, email, password_hash, display_name, email_verified_at, created_at, updated_at)
      VALUES (${aliceId}, ${ALICE_EMAIL}, ${hash}, ${ALICE_NAME}, ${now}, ${now}, ${now})
    `;

    if (firstHousehold) {
      await tx`
        INSERT INTO household_members (household_id, user_id, role, invited_at, joined_at)
        VALUES (${firstHousehold.id}, ${aliceId}, ${'viewer'}, ${now}, ${now})
      `;
    }
  });

  console.log(`  ✓ Alice creada: ${ALICE_EMAIL}`);
  if (firstHousehold) {
    console.log(`    → Añadida como viewer a "${firstHousehold.name}"`);
  } else {
    console.log(`    → Sin hogar (no existe ninguno todavía)`);
  }
}

// ── Bob ───────────────────────────────────────────────────────────────────────

const BOB_EMAIL = 'bob@pradomotica.local';
const BOB_PASSWORD = 'Bob1234!';
const BOB_NAME = 'Bob (prueba)';

const [existingBob] = await client`SELECT id FROM users WHERE email = ${BOB_EMAIL} LIMIT 1`;

if (existingBob) {
  console.log(`  ⏭  Bob ya existe (${BOB_EMAIL})`);
} else {
  const bobId = newId();
  const now = new Date();
  const hash = await hashPassword(BOB_PASSWORD);

  await client`
    INSERT INTO users (id, email, password_hash, display_name, email_verified_at, created_at, updated_at)
    VALUES (${bobId}, ${BOB_EMAIL}, ${hash}, ${BOB_NAME}, ${now}, ${now}, ${now})
  `;

  console.log(`  ✓ Bob creado:  ${BOB_EMAIL}`);
  console.log(`    → Sin hogar asignado (úsalo para probar la asignación manual)`);
}

await client.end();

console.log('');
console.log('✅ Listo. Cuentas de prueba disponibles:');
console.log('');
console.log('   alice@pradomotica.local  /  Alice1234!');
console.log('   bob@pradomotica.local    /  Bob1234!');
console.log('');
