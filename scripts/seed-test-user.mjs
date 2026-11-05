/**
 * Seed: crea usuario de prueba si no existe.
 * Ejecutar con:  node --env-file=.env.local scripts/seed-test-user.mjs
 *
 * Credenciales de prueba:
 *   Email:    test@pradomotica.local
 *   Password: Test1234!
 */

import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const TEST_EMAIL = 'test@pradomotica.local';
const TEST_PASSWORD = 'Test1234!';
const TEST_NAME = 'Usuario de prueba';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL no definida. Usa: node --env-file=apps/web/.env.local scripts/seed-test-user.mjs');
  process.exit(1);
}

// Argon2 via WASM-compatible approach: usar la librería argon2 instalada.
const { default: argon2 } = await import('argon2');

const client = postgres(url, { max: 1 });
const sql = client;

// Helpers
function newId() {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

console.log('🌱 Seeding test user...');

const [existing] = await sql`SELECT id FROM users WHERE email = ${TEST_EMAIL} LIMIT 1`;

if (existing) {
  console.log(`✅ Ya existe: ${TEST_EMAIL}`);
  await client.end();
  process.exit(0);
}

const passwordHash = await argon2.hash(TEST_PASSWORD, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
});

const userId = newId();
const householdId = newId();
const now = new Date();

await sql.begin(async (tx) => {
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

console.log('');
console.log('✅ Usuario de prueba creado correctamente.');
console.log(`   Email:    ${TEST_EMAIL}`);
console.log(`   Password: ${TEST_PASSWORD}`);
console.log('');

await client.end();
