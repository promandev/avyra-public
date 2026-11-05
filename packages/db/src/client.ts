import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

let _client: postgres.Sql | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Lazy singleton DB client. Use `getDb()` from server-side code only.
 * Connection string comes from `DATABASE_URL`.
 */
export function getDb() {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  _client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  _db = drizzle(_client, { schema, logger: process.env.NODE_ENV !== 'production' });
  return _db;
}

export type Db = ReturnType<typeof getDb>;
