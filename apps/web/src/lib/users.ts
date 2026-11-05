import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, users, type User } from '@pradomotica/db';

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return u;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u;
}
