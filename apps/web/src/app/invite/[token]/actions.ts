'use server';

import { redirect } from 'next/navigation';
import argon2 from 'argon2';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import {
  getDb,
  users,
  households,
  householdInvites,
  householdMembers,
} from '@pradomotica/db';
import { newId } from '@/lib/id';
import { signIn } from '@/lib/auth';
import { hashInviteToken } from '@/lib/invite-token';

// ─── Consultar la invitación sin sesión ──────────────────────────────────────

export type InvitePreview =
  | { status: 'invalid' | 'expired' }
  | {
      status: 'ok';
      email: string;
      householdName: string;
      role: string;
      hasAccount: boolean;
    };

/**
 * Devuelve el estado de una invitación a partir de su token, sin requerir
 * sesión. Sirve para decidir si el invitado debe registrarse (no tiene cuenta)
 * o iniciar sesión (ya la tiene).
 */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const db = getDb();
  const tokenHash = hashInviteToken(token);

  const [invite] = await db
    .select({
      email: householdInvites.email,
      role: householdInvites.role,
      expiresAt: householdInvites.expiresAt,
      acceptedAt: householdInvites.acceptedAt,
      householdName: households.name,
    })
    .from(householdInvites)
    .innerJoin(households, eq(households.id, householdInvites.householdId))
    .where(eq(householdInvites.tokenHash, tokenHash))
    .limit(1);

  if (!invite || invite.acceptedAt) return { status: 'invalid' };
  if (invite.expiresAt < new Date()) return { status: 'expired' };

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, invite.email.toLowerCase()))
    .limit(1);

  return {
    status: 'ok',
    email: invite.email,
    householdName: invite.householdName,
    role: invite.role,
    hasAccount: !!existingUser,
  };
}

// ─── Registro con invitación ─────────────────────────────────────────────────

export type RegisterInviteState = {
  errors?: Partial<Record<string, string[]>>;
  message?: string;
};

/**
 * Crea la cuenta del invitado (nombre + contraseña, email fijado al de la
 * invitación), lo une al hogar y le inicia sesión automáticamente.
 */
export async function registerWithInvite(
  _prev: RegisterInviteState,
  formData: FormData,
): Promise<RegisterInviteState> {
  const t = await getTranslations('onboarding');
  const tm = await getTranslations('members');

  const schema = z
    .object({
      token: z.string().min(1),
      displayName: z.string().min(2, t('minName')).max(60),
      password: z
        .string()
        .min(8, t('minPassword'))
        .max(128)
        .regex(/[A-Z]/, t('requireUppercase'))
        .regex(/[0-9]/, t('requireNumber')),
      passwordConfirm: z.string(),
    })
    .refine((d) => d.password === d.passwordConfirm, {
      message: t('passwordsMismatch'),
      path: ['passwordConfirm'],
    });

  const parsed = schema.safeParse({
    token: formData.get('token'),
    displayName: formData.get('displayName'),
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const { token, displayName, password } = parsed.data;
  const db = getDb();
  const tokenHash = hashInviteToken(token);
  const now = new Date();

  const [invite] = await db
    .select({
      id: householdInvites.id,
      householdId: householdInvites.householdId,
      email: householdInvites.email,
      role: householdInvites.role,
      expiresAt: householdInvites.expiresAt,
      acceptedAt: householdInvites.acceptedAt,
    })
    .from(householdInvites)
    .where(eq(householdInvites.tokenHash, tokenHash))
    .limit(1);

  if (!invite || invite.acceptedAt) return { message: tm('inviteInvalid') };
  if (invite.expiresAt < now) return { message: tm('inviteExpired') };

  const email = invite.email.toLowerCase();

  // Si la cuenta ya existe, debe iniciar sesión en lugar de registrarse.
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) return { message: tm('inviteAccountExists') };

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const userId = newId();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email,
      passwordHash,
      displayName,
      isAdmin: false,
      // La invitación llegó a este email, así que queda verificado.
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(householdMembers).values({
      householdId: invite.householdId,
      userId,
      role: invite.role,
      joinedAt: now,
    });

    await tx
      .update(householdInvites)
      .set({ acceptedAt: now })
      .where(
        and(eq(householdInvites.id, invite.id), eq(householdInvites.tokenHash, tokenHash)),
      );
  });

  await signIn('credentials', {
    email,
    password,
    redirect: false,
  });

  redirect('/dashboard');
}
