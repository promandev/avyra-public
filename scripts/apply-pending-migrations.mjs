/**
 * Applies pending Drizzle migrations to the running local Postgres instance.
 * Mirrors the logic in dev-db.mjs but does NOT start/stop postgres.
 *
 * Usage:
 *   node --env-file=apps/web/.env.local scripts/apply-pending-migrations.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONNECTION_URL = process.env.DATABASE_URL;
if (!CONNECTION_URL) throw new Error('DATABASE_URL is required');

const { default: postgres } = await import('postgres');
const client = postgres(CONNECTION_URL, { max: 1 });

const migrationsFolder = join(__dirname, '..', 'packages', 'db', 'drizzle');

await client`
  CREATE TABLE IF NOT EXISTS drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash TEXT NOT NULL,
    created_at BIGINT
  )
`;

const applied = new Set(
  (await client`SELECT hash FROM drizzle_migrations`).map((r) => r.hash),
);

const files = (await readdir(migrationsFolder))
  .filter((f) => f.endsWith('.sql'))
  .sort();

let count = 0;
for (const file of files) {
  const hash = file.replace('.sql', '');
  if (applied.has(hash)) {
    console.log(`  ⏭  ${file} (already applied)`);
    continue;
  }
  const sql = await readFile(join(migrationsFolder, file), 'utf8');
  const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await client.unsafe(stmt);
  }
  await client`INSERT INTO drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
  console.log(`  ✓ ${file}`);
  count++;
}

await client.end();
console.log(count > 0 ? `\n✅ ${count} migration(s) applied.` : '\n✅ Nothing to apply.');
