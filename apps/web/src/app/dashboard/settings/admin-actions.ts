'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and, inArray, notInArray } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { newId } from '@/lib/id';
import {
  getDb,
  users,
  households,
  householdMembers,
  type HouseholdRole,
} from '@pradomotica/db';

// ─── Guard ────────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const db = getDb();
  const [row] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!row?.isAdmin) return null;
  return session.user.id;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminHousehold = {
  id: string;
  name: string;
  address: string | null;
  ownerId: string;
  members: {
    userId: string;
    role: HouseholdRole;
    email: string;
    displayName: string | null;
  }[];
};

export type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  pushEnabled: boolean;
};

export type AdminData = {
  households: AdminHousehold[];
  allUsers: AdminUser[];
};

export type AdminActionResult = { error?: string; success?: boolean };

// ─── Fetch all admin data ─────────────────────────────────────────────────────

export async function getAdminData(): Promise<AdminData | { error: string }> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const db = getDb();

  const [allHouseholds, allMembers, allUsers] = await Promise.all([
    db.select({ id: households.id, name: households.name, address: households.address, ownerId: households.ownerId }).from(households).orderBy(households.createdAt),
    db
      .select({
        householdId: householdMembers.householdId,
        userId: householdMembers.userId,
        role: householdMembers.role,
        email: users.email,
        displayName: users.displayName,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId)),
    db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isAdmin: users.isAdmin,
        pushEnabled: users.pushEnabled,
      })
      .from(users)
      .orderBy(users.createdAt),
  ]);

  const membersByHousehold = new Map<string, AdminHousehold['members']>();
  for (const m of allMembers) {
    if (!membersByHousehold.has(m.householdId)) {
      membersByHousehold.set(m.householdId, []);
    }
    membersByHousehold.get(m.householdId)!.push({
      userId: m.userId,
      role: m.role,
      email: m.email,
      displayName: m.displayName,
    });
  }

  return {
    households: allHouseholds.map((h) => ({
      ...h,
      members: membersByHousehold.get(h.id) ?? [],
    })),
    allUsers,
  };
}

// ─── Create household ─────────────────────────────────────────────────────────

const createHouseholdSchema = z.object({
  name: z.string().min(2).max(80),
  address: z.string().max(200).optional(),
  ownerId: z.string().min(1),
});

export async function adminCreateHousehold(
  _prev: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const parsed = createHouseholdSchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address') || undefined,
    ownerId: formData.get('ownerId'),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { name, address, ownerId } = parsed.data;
  const db = getDb();

  // Verify user exists
  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!targetUser) return { error: 'Usuario no encontrado' };

  const householdId = newId();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(households).values({
      id: householdId,
      name,
      address: address ?? null,
      ownerId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(householdMembers).values({
      householdId,
      userId: ownerId,
      role: 'owner',
      invitedAt: now,
      joinedAt: now,
    });
  });

  revalidatePath('/dashboard/settings');
  return { success: true };
}

// ─── Update household ─────────────────────────────────────────────────────────

const updateHouseholdSchema = z.object({
  householdId: z.string().min(1),
  name: z.string().min(2).max(80),
  address: z.string().max(200).optional(),
});

export async function adminUpdateHousehold(
  _prev: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const parsed = updateHouseholdSchema.safeParse({
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

  await db
    .update(households)
    .set({ name, address: address ?? null, updatedAt: new Date() })
    .where(eq(households.id, householdId));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Delete household ─────────────────────────────────────────────────────────

export async function adminDeleteHousehold(householdId: string): Promise<AdminActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const db = getDb();
  await db.delete(households).where(eq(households.id, householdId));

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

// ─── Add member to household ──────────────────────────────────────────────────

const addMemberSchema = z.object({
  householdId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'viewer']),
});

export async function adminAddMember(
  _prev: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const parsed = addMemberSchema.safeParse({
    householdId: formData.get('householdId'),
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { householdId, userId, role } = parsed.data;
  const db = getDb();

  // Check if already a member
  const [existing] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);

  if (existing) return { error: 'El usuario ya es miembro de este hogar' };

  const now = new Date();
  await db.insert(householdMembers).values({
    householdId,
    userId,
    role,
    invitedAt: now,
    joinedAt: now,
  });

  revalidatePath('/dashboard/settings');
  return { success: true };
}

// ─── Remove member from household ────────────────────────────────────────────

export async function adminRemoveMember(
  householdId: string,
  userId: string,
): Promise<AdminActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const db = getDb();
  await db
    .delete(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));

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

export async function adminUpdateMemberRole(
  _prev: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const parsed = updateRoleSchema.safeParse({
    householdId: formData.get('householdId'),
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? 'Datos inválidos' };
  }

  const { householdId, userId, role } = parsed.data;
  const db = getDb();

  await db
    .update(householdMembers)
    .set({ role })
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));

  revalidatePath('/dashboard/settings');
  return { success: true };
}

// ─── Enable/disable push notifications for a user ─────────────────────────────

export async function adminSetUserPushEnabled(
  userId: string,
  enabled: boolean,
): Promise<AdminActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { error: 'Sin permisos' };

  const db = getDb();
  await db.update(users).set({ pushEnabled: enabled }).where(eq(users.id, userId));

  revalidatePath('/dashboard/settings');
  return { success: true };
}
