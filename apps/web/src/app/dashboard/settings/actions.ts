'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and, count, inArray } from 'drizzle-orm';
import { authenticator } from 'otplib';
import argon2 from 'argon2';

import { auth } from '@/lib/auth';
import { encrypt, decrypt } from '@/lib/crypto';
import { newId } from '@/lib/id';
import { isPushCategory, type PushCategory } from '@/lib/push-categories';
import {
  getActiveHouseholdId,
  persistActiveHousehold,
} from '@/lib/household';
import {
  getDb,
  households,
  householdMembers,
  users,
  type HouseholdRole,
} from '@pradomotica/db';

// ─── Switch active household ───────────────────────────────────────────────

export async function switchHousehold(householdId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const db = getDb();
  const [member] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, session.user.id),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member) return;

  await persistActiveHousehold(householdId);
  redirect('/dashboard');
}

// ─── Create household ──────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(2).max(80),
  address: z.string().max(200).optional(),
});

export type CreateHouseholdState = { error?: string; success?: boolean };

export async function createHousehold(
  _prev: CreateHouseholdState,
  formData: FormData,
): Promise<CreateHouseholdState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address') || undefined,
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { name, address } = parsed.data;
  const db = getDb();
  const householdId = newId();
  const userId = session.user.id;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(households).values({
      id: householdId,
      name,
      address: address ?? null,
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

  await persistActiveHousehold(householdId);
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Update household ──────────────────────────────────────────────────────

const updateSchema = z.object({
  name: z.string().min(2).max(80),
  address: z.string().max(200).optional(),
});

export type UpdateHouseholdState = { error?: string; success?: boolean };

export async function updateHousehold(
  _prev: UpdateHouseholdState,
  formData: FormData,
): Promise<UpdateHouseholdState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: 'Sin hogar activo' };

  // Only owner/admin can rename
  const db = getDb();
  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, session.user.id),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member || !(['owner', 'admin'] as HouseholdRole[]).includes(member.role)) {
    return { error: 'Sin permisos' };
  }

  const parsed = updateSchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address') || undefined,
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  await db
    .update(households)
    .set({ name: parsed.data.name, address: parsed.data.address ?? null, updatedAt: new Date() })
    .where(eq(households.id, householdId));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Leave household ───────────────────────────────────────────────────────

export async function leaveHousehold(): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: 'Sin hogar activo' };

  const db = getDb();
  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, session.user.id),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member) return { error: 'No eres miembro de este hogar' };

  // Owner can only leave if there are other owners or no members left
  if (member.role === 'owner') {
    const [ownerRow] = await db
      .select({ value: count() })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.role, 'owner'),
        ),
      );

    if ((ownerRow?.value ?? 0) <= 1) {
      return {
        error:
          'Eres el único propietario. Transfiere la propiedad a otro miembro o elimina el hogar.',
      };
    }
  }

  await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, session.user.id),
      ),
    );

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

// ─── Delete household ──────────────────────────────────────────────────────

export async function deleteHousehold(): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: 'Sin hogar activo' };

  const db = getDb();
  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, session.user.id),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member || member.role !== 'owner') {
    return { error: 'Solo el propietario puede eliminar el hogar' };
  }

  // Delete household (cascades to members, devices via FK)
  await db.delete(households).where(eq(households.id, householdId));

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

// ─── TOTP 2FA ──────────────────────────────────────────────────────────────

/** Genera un secreto TOTP, lo guarda cifrado y devuelve el URI para el authenticator. */
export async function initiateTotpSetup(): Promise<
  { secret: string; uri: string } | { error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const secret = authenticator.generateSecret(20);
  const uri = authenticator.keyuri(session.user.email ?? session.user.id, 'Avyra', secret);

  const db = getDb();
  await db
    .update(users)
    .set({ totpSecretEnc: encrypt(secret) })
    .where(eq(users.id, session.user.id));

  return { secret, uri };
}

/** Verifica el código introducido y activa el 2FA. */
export async function confirmTotpSetup(code: string): Promise<{ success: true } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const db = getDb();
  const [user] = await db
    .select({ totpSecretEnc: users.totpSecretEnc })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user?.totpSecretEnc) return { error: 'Configuración no iniciada' };

  const secret = decrypt(user.totpSecretEnc);
  if (!authenticator.check(code, secret)) return { error: 'Código incorrecto' };

  await db
    .update(users)
    .set({ totpEnabled: true })
    .where(eq(users.id, session.user.id));

  revalidatePath('/dashboard/settings');
  return { success: true };
}

/** Desactiva el 2FA tras verificar el código actual. */
export async function disableTotp(code: string): Promise<{ success: true } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const db = getDb();
  const [user] = await db
    .select({ totpSecretEnc: users.totpSecretEnc, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user?.totpEnabled || !user.totpSecretEnc) return { error: '2FA no está activado' };

  const secret = decrypt(user.totpSecretEnc);
  if (!authenticator.check(code, secret)) return { error: 'Código incorrecto' };

  await db
    .update(users)
    .set({ totpEnabled: false, totpSecretEnc: null })
    .where(eq(users.id, session.user.id));

  revalidatePath('/dashboard/settings');
  return { success: true };
}

// ─── Change password ────────────────────────────────────────────────────────

export type ChangePasswordState = { error?: string; success?: boolean };

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const schema = z
    .object({
      currentPassword: z.string().min(1, 'Campo obligatorio'),
      newPassword: z
        .string()
        .min(8, 'Mínimo 8 caracteres')
        .max(128)
        .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
        .regex(/[0-9]/, 'Debe contener al menos un número'),
      confirmPassword: z.string(),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: 'Las contraseñas no coinciden',
      path: ['confirmPassword'],
    });

  const parsed = schema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { currentPassword, newPassword } = parsed.data;
  const db = getDb();

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user?.passwordHash) return { error: 'Usuario no encontrado' };

  const ok = await argon2.verify(user.passwordHash, currentPassword);
  if (!ok) return { error: 'Contraseña actual incorrecta' };

  const newHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  revalidatePath('/dashboard/settings');
  return { success: true };
}

// ─── Update display name ──────────────────────────────────────────────────

export type UpdateDisplayNameState = { error?: string; success?: boolean };

export async function updateDisplayName(
  _prev: UpdateDisplayNameState,
  formData: FormData,
): Promise<UpdateDisplayNameState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const name = (formData.get('displayName') as string | null)?.trim();
  if (!name || name.length < 1 || name.length > 80) {
    return { error: 'El nombre debe tener entre 1 y 80 caracteres' };
  }

  const db = getDb();
  await db
    .update(users)
    .set({ displayName: name, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Update household by ID ────────────────────────────────────────────────

const updateByIdSchema = z.object({
  householdId: z.string().min(1),
  name: z.string().min(2).max(80),
  address: z.string().max(200).optional(),
});

export async function updateHouseholdById(
  _prev: UpdateHouseholdState,
  formData: FormData,
): Promise<UpdateHouseholdState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const parsed = updateByIdSchema.safeParse({
    householdId: formData.get('householdId'),
    name: formData.get('name'),
    address: formData.get('address') || undefined,
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { householdId, name, address } = parsed.data;
  const db = getDb();

  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, session.user.id),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member || !(['owner', 'admin'] as HouseholdRole[]).includes(member.role)) {
    return { error: 'Sin permisos' };
  }

  await db
    .update(households)
    .set({ name, address: address ?? null, updatedAt: new Date() })
    .where(eq(households.id, householdId));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Delete household by ID ────────────────────────────────────────────────

export async function deleteHouseholdById(householdId: string): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const db = getDb();
  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, session.user.id),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member || member.role !== 'owner') {
    return { error: 'Solo el propietario puede eliminar el hogar' };
  }

  await db.delete(households).where(eq(households.id, householdId));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return {};
}

// ─── Leave household by ID ─────────────────────────────────────────────────

export async function leaveHouseholdById(householdId: string): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const db = getDb();
  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, session.user.id),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member) return { error: 'No eres miembro de este hogar' };

  if (member.role === 'owner') {
    const [ownerRow] = await db
      .select({ value: count() })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.role, 'owner'),
        ),
      );

    if ((ownerRow?.value ?? 0) <= 1) {
      return {
        error:
          'Eres el único propietario. Transfiere la propiedad a otro miembro o elimina el hogar.',
      };
    }
  }

  await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, session.user.id),
      ),
    );

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return {};
}

// ─── Get all user households with members ─────────────────────────────────

export type UserHouseholdMember = {
  userId: string;
  role: HouseholdRole;
  email: string;
  displayName: string | null;
  joinedAt: Date | null;
};

export type UserHousehold = {
  id: string;
  name: string;
  address: string | null;
  ownerId: string;
  myRole: HouseholdRole;
  members: UserHouseholdMember[];
};

export async function getUserHouseholds(userId: string): Promise<UserHousehold[]> {
  const db = getDb();

  const memberships = await db
    .select({ householdId: householdMembers.householdId, myRole: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId));

  if (memberships.length === 0) return [];

  const householdIds = memberships.map((m) => m.householdId);

  const [allHouseholds, allMembers] = await Promise.all([
    db
      .select({
        id: households.id,
        name: households.name,
        address: households.address,
        ownerId: households.ownerId,
      })
      .from(households)
      .where(inArray(households.id, householdIds)),
    db
      .select({
        householdId: householdMembers.householdId,
        userId: householdMembers.userId,
        role: householdMembers.role,
        joinedAt: householdMembers.joinedAt,
        email: users.email,
        displayName: users.displayName,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(inArray(householdMembers.householdId, householdIds)),
  ]);

  const roleMap = new Map(memberships.map((m) => [m.householdId, m.myRole]));
  const membersByHousehold = new Map<string, UserHouseholdMember[]>();
  for (const m of allMembers) {
    if (!membersByHousehold.has(m.householdId)) membersByHousehold.set(m.householdId, []);
    membersByHousehold.get(m.householdId)!.push({
      userId: m.userId,
      role: m.role,
      email: m.email,
      displayName: m.displayName,
      joinedAt: m.joinedAt,
    });
  }

  return allHouseholds.map((h) => ({
    ...h,
    myRole: roleMap.get(h.id)!,
    members: membersByHousehold.get(h.id) ?? [],
  }));
}

// ─── Push notification categories ─────────────────────────────────────────

/** Columna de `users` detrás de cada interruptor de categoría. */
const PUSH_CATEGORY_COLUMN = {
  cameras: 'pushCameras',
  lights: 'pushLights',
  heating: 'pushHeating',
  ac: 'pushAc',
  vacuum: 'pushVacuum',
  litter: 'pushLitter',
  printer: 'pushPrinter',
} as const satisfies Record<PushCategory, keyof typeof users.$inferSelect>;

/**
 * Silencia o reactiva una categoría de aviso para el usuario que la pide.
 *
 * Es una preferencia de cada cuenta, no del hogar: el que no quiere saber que se
 * ha encendido una luz no se lo quita a los demás.
 */
export async function setPushCategory(
  category: PushCategory,
  enabled: boolean,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  // La categoría llega del navegador: sin comprobarla se podría escribir
  // cualquier columna de `users`.
  if (!isPushCategory(category) || typeof enabled !== 'boolean') {
    return { error: 'Datos no válidos' };
  }

  const db = getDb();
  await db
    .update(users)
    .set({ [PUSH_CATEGORY_COLUMN[category]]: enabled, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  revalidatePath('/dashboard/settings');
  return {};
}
