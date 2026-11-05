'use server';

import { redirect } from 'next/navigation';
import argon2 from 'argon2';
import { z } from 'zod';
import { getDb, users, households, householdMembers } from '@pradomotica/db';
import { getTranslations } from 'next-intl/server';

import { newId } from '@/lib/id';
import { signIn } from '@/lib/auth';

export type OnboardingState = {
  errors?: Partial<Record<string, string[]>>;
  message?: string;
};

export async function createOwnerAccount(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const t = await getTranslations('onboarding');

  const schema = z.object({
    displayName: z.string().min(2, t('minName')).max(60),
    email: z.string().email(t('invalidEmail')),
    password: z
      .string()
      .min(8, t('minPassword'))
      .max(128)
      .regex(/[A-Z]/, t('requireUppercase'))
      .regex(/[0-9]/, t('requireNumber')),
    passwordConfirm: z.string(),
  }).refine((d) => d.password === d.passwordConfirm, {
    message: t('passwordsMismatch'),
    path: ['passwordConfirm'],
  });

  const parsed = schema.safeParse({
    displayName: formData.get('displayName'),
    email: formData.get('email'),
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const { displayName, email, password } = parsed.data;

  let db;
  try {
    db = getDb();
  } catch {
    return { message: t('dbUnavailable') };
  }

  // Comprobar que no existe ya un usuario.
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) {
    return { message: t('adminExists') };
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const userId = newId();
  const householdId = newId();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email: email.toLowerCase(),
      passwordHash,
      displayName,
      isAdmin: true,
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(households).values({
      id: householdId,
      name: t('defaultHome'),
      ownerId: userId,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(householdMembers).values({
      householdId,
      userId,
      role: 'owner',
      invitedAt: now,
      joinedAt: now,
    });
  });

  // Auto sign-in tras el registro.
  await signIn('credentials', {
    email: email.toLowerCase(),
    password,
    redirect: false,
  });

  redirect('/dashboard');
}
