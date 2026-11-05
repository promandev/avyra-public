#!/usr/bin/env node
/**
 * Migra todos los dispositivos de un hogar a otro.
 * Útil para consolidar datos creados con un usuario de prueba en tu cuenta real.
 *
 * Uso:
 *   node --env-file=apps/web/.env.local scripts/migrate-household.mjs \
 *     --from "usuario-origen@email.com" \
 *     --to   "tu@email.com"
 *
 * Sin flags, muestra un listado de todos los usuarios y hogares disponibles
 * y pide confirmación antes de migrar.
 */

import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import postgres from 'postgres';

// ─── Parse args ──────────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  options: {
    from: { type: 'string' },
    to:   { type: 'string' },
  },
  strict: false,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function formatHousehold(h) {
  return `  [${h.id.slice(0, 8)}…] "${h.householdName}" (propietario: ${h.displayName ?? h.email})`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL no definida.');
  console.error('Ejecuta: node --env-file=apps/web/.env.local scripts/migrate-household.mjs');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const rl  = createInterface({ input: process.stdin, output: process.stdout });

// ─── Listar usuarios/hogares ─────────────────────────────────────────────────

const households = await sql`
  SELECT
    h.id,
    h.name        AS "householdName",
    u.email,
    u.display_name AS "displayName",
    COUNT(d.id)::int AS "deviceCount"
  FROM households h
  JOIN users u ON u.id = h.owner_id
  LEFT JOIN devices d ON d.household_id = h.id
  GROUP BY h.id, h.name, u.email, u.display_name
  ORDER BY h.created_at
`;

if (households.length === 0) {
  console.log('No hay hogares en la base de datos. Crea primero un usuario con:');
  console.log('   node --env-file=apps/web/.env.local scripts/create-admin.mjs');
  rl.close();
  await sql.end();
  process.exit(0);
}

console.log('\n📋 Hogares disponibles:\n');
for (const h of households) {
  console.log(`${formatHousehold(h)}  — ${h.deviceCount} dispositivo(s)`);
}
console.log('');

// ─── Determinar origen y destino ─────────────────────────────────────────────

let fromEmail = flags.from?.trim().toLowerCase();
let toEmail   = flags.to?.trim().toLowerCase();

if (!fromEmail) {
  fromEmail = (await prompt(rl, 'Email del usuario ORIGEN (del que vienen los dispositivos): ')).trim().toLowerCase();
}
if (!toEmail) {
  toEmail = (await prompt(rl, 'Email del usuario DESTINO (al que van los dispositivos): ')).trim().toLowerCase();
}

const fromHousehold = households.find(h => h.email.toLowerCase() === fromEmail);
const toHousehold   = households.find(h => h.email.toLowerCase() === toEmail);

if (!fromHousehold) {
  console.error(`\nERROR: No se encontró ningún hogar para el email: ${fromEmail}`);
  rl.close();
  await sql.end();
  process.exit(1);
}
if (!toHousehold) {
  console.error(`\nERROR: No se encontró ningún hogar para el email: ${toEmail}`);
  rl.close();
  await sql.end();
  process.exit(1);
}
if (fromHousehold.id === toHousehold.id) {
  console.log('\nOrigen y destino son el mismo hogar. No hay nada que migrar.');
  rl.close();
  await sql.end();
  process.exit(0);
}

// ─── Confirmar ───────────────────────────────────────────────────────────────

console.log('\nResumen de la migración:');
console.log(`  Origen:  "${fromHousehold.householdName}" (${fromEmail}) — ${fromHousehold.deviceCount} dispositivo(s)`);
console.log(`  Destino: "${toHousehold.householdName}" (${toEmail})`);
console.log('');

if (fromHousehold.deviceCount === 0) {
  console.log('ℹ️  El hogar origen no tiene dispositivos. No hay nada que migrar.');
  rl.close();
  await sql.end();
  process.exit(0);
}

const confirm = (await prompt(rl, '¿Continuar? (s/N): ')).trim().toLowerCase();
rl.close();

if (confirm !== 's' && confirm !== 'si' && confirm !== 'sí' && confirm !== 'y' && confirm !== 'yes') {
  console.log('Cancelado.');
  await sql.end();
  process.exit(0);
}

// ─── Migrar ───────────────────────────────────────────────────────────────────

const result = await sql`
  UPDATE devices
  SET household_id = ${toHousehold.id}, updated_at = NOW()
  WHERE household_id = ${fromHousehold.id}
  RETURNING id, name, type
`;

console.log(`\n✅ ${result.length} dispositivo(s) migrado(s) correctamente:\n`);
for (const d of result) {
  console.log(`   [${d.type}] ${d.name}`);
}

console.log('\nPuedes eliminar el usuario de prueba desde la base de datos si ya no lo necesitas:');
console.log(`   pnpm db:studio  →  tabla "users"  →  eliminar ${fromEmail}`);

await sql.end();
