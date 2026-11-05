'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { newId } from '@/lib/id';
import {
  getDb,
  households,
  householdMembers,
  users,
  type HouseholdRole,
} from '@pradomotica/db';

// ─── Guard ────────────────────────────────────────────────────────────────────

async function requireOwnerOf(householdId: string): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

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

  if (!member || member.role !== 'owner') return null;
  return session.user.id;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type OwnerActionResult = { error?: string; success?: boolean };

// ─── Update household ─────────────────────────────────────────────────────────

const updateSchema = z.object({
  householdId: z.string().min(1),
  name: z.string().min(2).max(80),
  address: z.string().max(200).optional(),
});

export async function ownerUpdateHousehold(
  _prev: OwnerActionResult,
  formData: FormData,
): Promise<OwnerActionResult> {
  const parsed = updateSchema.safeParse({
    householdId: formData.get('householdId'),
    name: formData.get('name'),
    address: formData.get('address') || undefined,
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { householdId, name, address } = parsed.data;
  const userId = await requireOwnerOf(householdId);
  if (!userId) return { error: 'Sin permisos' };

  const db = getDb();
  await db
    .update(households)
    .set({ name, address: address ?? null, updatedAt: new Date() })
    .where(eq(households.id, householdId));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Delete household ─────────────────────────────────────────────────────────

export async function ownerDeleteHousehold(householdId: string): Promise<OwnerActionResult> {
  const userId = await requireOwnerOf(householdId);
  if (!userId) return { error: 'Sin permisos' };

  const db = getDb();
  await db.delete(households).where(eq(households.id, householdId));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Add member ───────────────────────────────────────────────────────────────

const addMemberSchema = z.object({
  householdId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'viewer']),
});

export async function ownerAddMember(
  _prev: OwnerActionResult,
  formData: FormData,
): Promise<OwnerActionResult> {
  const parsed = addMemberSchema.safeParse({
    householdId: formData.get('householdId'),
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { householdId, userId: targetUserId, role } = parsed.data;
  const ownerId = await requireOwnerOf(householdId);
  if (!ownerId) return { error: 'Sin permisos' };

  const db = getDb();

  // Cannot assign admin role to a user who is a global admin
  const [targetUser] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!targetUser) return { error: 'Usuario no encontrado' };

  const [existing] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, targetUserId),
      ),
    )
    .limit(1);

  if (existing) return { error: 'El usuario ya es miembro de este hogar' };

  const now = new Date();
  await db.insert(householdMembers).values({
    householdId,
    userId: targetUserId,
    role,
    invitedAt: now,
    joinedAt: now,
  });

  revalidatePath('/dashboard/settings');
  return { success: true };
}

// ─── Remove member ────────────────────────────────────────────────────────────

export async function ownerRemoveMember(
  householdId: string,
  targetUserId: string,
): Promise<OwnerActionResult> {
  const ownerId = await requireOwnerOf(householdId);
  if (!ownerId) return { error: 'Sin permisos' };

  // Cannot remove self
  if (ownerId === targetUserId) return { error: 'No puedes eliminarte a ti mismo' };

  const db = getDb();

  // Cannot remove global admins
  const [targetUser] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (targetUser?.isAdmin) return { error: 'No se puede eliminar a un administrador global' };

  await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, targetUserId),
      ),
    );

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Update member role ───────────────────────────────────────────────────────

const updateRoleSchema = z.object({
  householdId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'viewer']),
});

export async function ownerUpdateMemberRole(
  _prev: OwnerActionResult,
  formData: FormData,
): Promise<OwnerActionResult> {
  const parsed = updateRoleSchema.safeParse({
    householdId: formData.get('householdId'),
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { householdId, userId: targetUserId, role } = parsed.data;
  const ownerId = await requireOwnerOf(householdId);
  if (!ownerId) return { error: 'Sin permisos' };

  const db = getDb();

  // Cannot change role of global admins
  const [targetUser] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (targetUser?.isAdmin) return { error: 'No se puede modificar el rol de un administrador global' };

  await db
    .update(householdMembers)
    .set({ role })
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, targetUserId),
      ),
    );

  revalidatePath('/dashboard/settings');
  return { success: true };
}
