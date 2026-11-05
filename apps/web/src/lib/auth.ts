import 'server-only';
import { createHash } from 'node:crypto';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { eq, and, gt } from 'drizzle-orm';

import { decrypt } from './crypto';
import { findUserByEmail, findUserById } from './users';
import { getDb, users, oauthAccounts, loginAttempts } from '@pradomotica/db';
import { newId } from './id';

/**
 * Configuración Auth.js v5 con cookie httpOnly Secure SameSite=Strict.
 * - Provider de credenciales (email + password + TOTP).
 * - El flujo de Passkeys se maneja con SimpleWebAuthn en rutas dedicadas
 *   y, tras verificar, se crea sesión usando la API de Auth.js.
 */
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  // El form envía '' cuando el campo TOTP no se rellena; lo normalizamos a undefined.
  totp: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^\d{6}$/).optional(),
  ),
});

export const authConfig = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30, // 30 días
    updateAge: 60 * 60 * 24,   // renovar cada 24h
  },
  cookies: {
    sessionToken: {
      // En producción (HTTPS) usamos el prefijo __Host- para máxima seguridad.
      // En desarrollo (HTTP localhost) el prefijo __Host- requiere Secure y el
      // browser descarta la cookie → el usuario tiene que loguearse cada vez.
      name: process.env.NODE_ENV === 'production'
        ? '__Host-avyra.session'
        : 'avyra.session',
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      // Sólo activo si están configuradas las env vars
      authorization: { params: { prompt: 'select_account' } },
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'TOTP', type: 'text' },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password, totp } = parsed.data;
        const emailNorm = email.toLowerCase();

        // ─── Rate limiting ─────────────────────────────────────────────────────
        const rawIp =
          (request as Request | undefined)?.headers?.get('x-forwarded-for')
            ?.split(',')[0]?.trim() ??
          (request as Request | undefined)?.headers?.get('x-real-ip') ??
          'unknown';
        const ipHash = createHash('sha256').update(rawIp).digest('hex');

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

        // 5 failed attempts in 15 min → silently block
        if (recentFailures.length >= 5) return null;

        // ─── Helper to log attempts ─────────────────────────────────────────────
        async function recordAttempt(success: boolean) {
          await db.insert(loginAttempts).values({
            id: newId(),
            identifier: emailNorm,
            success,
            ipHash,
          });
        }

        // ─── Verify credentials ────────────────────────────────────────────────
        const user = await findUserByEmail(emailNorm);
        if (!user || !user.passwordHash) {
          await recordAttempt(false);
          return null;
        }

        const ok = await argon2.verify(user.passwordHash, password);
        if (!ok) {
          await recordAttempt(false);
          return null;
        }

        if (user.totpEnabled) {
          if (!totp || !user.totpSecretEnc) {
            await recordAttempt(false);
            return null;
          }
          let secret: string;
          try {
            secret = decrypt(user.totpSecretEnc);
          } catch {
            // Decryption failed (e.g. key rotation) → treat as invalid TOTP
            await recordAttempt(false);
            return null;
          }
          const valid = authenticator.check(totp, secret);
          if (!valid) {
            await recordAttempt(false);
            return null;
          }
        }

        await recordAttempt(true);
        return {
          id: user.id,
          email: user.email,
          name: user.displayName ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      // Credentials: authorize() ya devolvió user.id
      if (user?.id) {
        token.sub = user.id;
        return token;
      }

      // OAuth (Google, etc.): solo permite usuarios ya registrados (no auto-registro)
      if (account?.provider && account.provider !== 'credentials' && profile?.email) {
        const email = profile.email.toLowerCase();
        const dbUser = await findUserByEmail(email);

        // Si el usuario no existe, rechazar el acceso — debe ser invitado primero.
        if (!dbUser) return token;

        // Vincular cuenta OAuth (ignorar si ya existe)
        const db = getDb();
        await db
          .insert(oauthAccounts)
          .values({
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            userId: dbUser.id,
          })
          .onConflictDoNothing();

        token.sub = dbUser.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (token.sub) {
        const u = await findUserById(token.sub);
        if (u) {
          session.user = {
            ...session.user,
            id: u.id,
            email: u.email,
            name: u.displayName ?? session.user?.name ?? null,
          };
        }
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

const { handlers, auth: rawAuth, signIn, signOut } = NextAuth(authConfig);

function isDevAuthBypassEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS === 'true';
}

export async function auth() {
  const session = await rawAuth();
  if (session || !isDevAuthBypassEnabled()) return session;

  // In dev bypass mode, reuse the seeded test user as current session.
  const devEmail = process.env.DEV_AUTH_EMAIL ?? 'test@pradomotica.local';
  const user = await findUserByEmail(devEmail);
  if (!user) return null;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.displayName ?? 'Dev User',
    },
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
}

export { handlers, signIn, signOut, isDevAuthBypassEnabled };
