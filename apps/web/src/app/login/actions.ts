'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import argon2 from 'argon2';
import { z } from 'zod';
import { eq, and, gt } from 'drizzle-orm';

import { getDb, loginAttempts } from '@pradomotica/db';
import { findUserByEmail } from '@/lib/users';
import { newId } from '@/lib/id';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export type CheckCredentialsResult =
  | { ok: false; error: 'invalid' | 'locked' }
  | { ok: true; needsTotp: boolean };

/**
 * Pre-verifica email + contraseña sin crear sesión.
 * Devuelve si el usuario tiene TOTP activado para mostrar el paso 2 solo entonces.
 */
export async function checkCredentials(
  email: string,
  password: string,
): Promise<CheckCredentialsResult> {
  try {
    return await _checkCredentials(email, password);
  } catch (err) {
    console.error('[checkCredentials] unexpected error:', err);
    throw err; // re-throw so Next.js still returns 500 (don't silently swallow)
  }
}

async function _checkCredentials(
  email: string,
  password: string,
): Promise<CheckCredentialsResult> {
  const parsed = schema.safeParse({ email, password });
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const emailNorm = parsed.data.email.toLowerCase();

  // ─── IP hash para rate limiting ──────────────────────────────────────────
  const headersList = await headers();
  const rawIp =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    'unknown';
  const ipHash = createHash('sha256').update(rawIp).digest('hex');

  // ─── Rate limiting (5 fallos en 15 min) ──────────────────────────────────
  const db = getDb();
  const windowStart = new Date(Date.now() - 15 * 60 * 1000);

  const recentFailures = await db
    .select({ id: loginAttempts.id })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, emailNorm),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, windowStart),
      ),
    );

  if (recentFailures.length >= 5) return { ok: false, error: 'locked' };

  // ─── Verificar credenciales ───────────────────────────────────────────────
  const user = await findUserByEmail(emailNorm);
  if (!user || !user.passwordHash) {
    await db.insert(loginAttempts).values({
      id: newId(),
      identifier: emailNorm,
      success: false,
      ipHash,
    });
    return { ok: false, error: 'invalid' };
  }

  const ok = await argon2.verify(user.passwordHash, parsed.data.password);
  if (!ok) {
    await db.insert(loginAttempts).values({
      id: newId(),
      identifier: emailNorm,
      success: false,
      ipHash,
    });
    return { ok: false, error: 'invalid' };
  }

  // Contraseña correcta — no registrar un intento exitoso aquí.
  // El login definitivo lo registra authorize() en auth.ts al llamar signIn().
  return { ok: true, needsTotp: user.totpEnabled };
}
