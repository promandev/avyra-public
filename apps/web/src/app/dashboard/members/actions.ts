'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and, gt, isNull } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { newId } from '@/lib/id';
import { getActiveHouseholdId } from '@/lib/household';
import {
  getDb,
  householdMembers,
  householdInvites,
  households,
  users,
  type HouseholdRole,
} from '@pradomotica/db';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Obtiene el householdId del usuario autenticado, comprobando que es owner o admin. */
async function getOwnedHousehold(
  userId: string,
  requiredRoles: HouseholdRole[] = ['owner', 'admin'],
) {
  const householdId = await getActiveHouseholdId(userId);
  if (!householdId) return null;

  const db = getDb();
  const [member] = await db
    .select({
      householdId: householdMembers.householdId,
      role: householdMembers.role,
      householdName: households.name,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(
      and(
        eq(householdMembers.userId, userId),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  if (!member || !requiredRoles.includes(member.role)) return null;
  return member;
}

// ─── List members ─────────────────────────────────────────────────────────────

export async function listHouseholdMembers() {
  const session = await auth();
  if (!session?.user?.id) return { error: 'notAuthenticated' as const };

  const db = getDb();
  const household = await getOwnedHousehold(session.user.id, ['owner', 'admin', 'viewer']);
  if (!household) return { error: 'noHomeConfigured' as const };

  const members = await db
    .select({
      userId: householdMembers.userId,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
      email: users.email,
      displayName: users.displayName,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, household.householdId));

  const invites = await db
    .select({
      id: householdInvites.id,
      email: householdInvites.email,
      role: householdInvites.role,
      expiresAt: householdInvites.expiresAt,
      createdAt: householdInvites.createdAt,
    })
    .from(householdInvites)
    .where(
      and(
        eq(householdInvites.householdId, household.householdId),
        isNull(householdInvites.acceptedAt),
        gt(householdInvites.expiresAt, new Date()),
      ),
    );

  return {
    householdId: household.householdId,
    householdName: household.householdName,
    currentUserId: session.user.id,
    currentRole: household.role,
    members,
    invites,
  };
}

// ─── Create invite ─────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'viewer']),
});

export type InviteState = { error?: string; inviteUrl?: string };

export async function createInvite(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const household = await getOwnedHousehold(session.user.id, ['owner', 'admin']);
  if (!household) return { error: 'No tienes permisos para invitar miembros' };

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.email?.[0] ?? 'Datos inválidos' };
  }

  const { email, role } = parsed.data;
  const db = getDb();

  // Comprobar si ya es miembro
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existingUser) {
    const [existingMember] = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, household.householdId),
          eq(householdMembers.userId, existingUser.id),
        ),
      )
      .limit(1);

    if (existingMember) return { error: 'Este usuario ya es miembro del hogar' };
  }

  // Generar token
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 72); // 72h

  await db.insert(householdInvites).values({
    id: newId(),
    householdId: household.householdId,
    email: email.toLowerCase(),
    role: role as HouseholdRole,
    tokenHash,
    expiresAt,
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const inviteUrl = `${appUrl}/invite/${token}`;

  revalidatePath('/dashboard/members');
  return { inviteUrl };
}

// ─── Revoke invite ─────────────────────────────────────────────────────────────

export async function revokeInvite(inviteId: string): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  const household = await getOwnedHousehold(session.user.id, ['owner', 'admin']);
  if (!household) return { error: 'Sin permisos' };

  const db = getDb();
  await db
    .delete(householdInvites)
    .where(
      and(
        eq(householdInvites.id, inviteId),
        eq(householdInvites.householdId, household.householdId),
      ),
    );

  revalidatePath('/dashboard/members');
  return {};
}

// ─── Remove member ─────────────────────────────────────────────────────────────

export async function removeMember(targetUserId: string): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };

  if (targetUserId === session.user.id) return { error: 'No puedes eliminarte a ti mismo' };

  const household = await getOwnedHousehold(session.user.id, ['owner', 'admin']);
  if (!household) return { error: 'Sin permisos' };

  const db = getDb();

  // Un admin no puede eliminar al owner
  const [target] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, household.householdId),
        eq(householdMembers.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!target) return { error: 'Miembro no encontrado' };
  if (target.role === 'owner' && household.role !== 'owner') {
    return { error: 'Solo el propietario puede eliminar a otro propietario' };
  }

  await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, household.householdId),
        eq(householdMembers.userId, targetUserId),
      ),
    );

  revalidatePath('/dashboard/members');
  return {};
}

// ─── Accept invite ─────────────────────────────────────────────────────────────

export type AcceptInviteResult =
  | { ok: true; householdName: string; role: HouseholdRole }
  | { ok: false; error: 'invalid' | 'expired' | 'alreadyMember' | 'notAuthenticated' | 'emailMismatch' };

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'notAuthenticated' };

  const tokenHash = hashToken(token);
  const db = getDb();
  const now = new Date();

  const [invite] = await db
    .select({
      id: householdInvites.id,
      householdId: householdInvites.householdId,
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

  if (!invite) return { ok: false, error: 'invalid' };
  if (invite.acceptedAt) return { ok: false, error: 'invalid' };
  if (invite.expiresAt < now) return { ok: false, error: 'expired' };

  // Only the invited email can accept
  const sessionEmail = session.user.email?.toLowerCase() ?? '';
  if (invite.email.toLowerCase() !== sessionEmail) {
    return { ok: false, error: 'emailMismatch' };
  }

  // Comprobar si ya es miembro
  const [existing] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, invite.householdId),
        eq(householdMembers.userId, session.user.id),
      ),
    )
    .limit(1);

  if (existing) return { ok: false, error: 'alreadyMember' };

  await db.transaction(async (tx) => {
    await tx.insert(householdMembers).values({
      householdId: invite.householdId,
      userId: session.user.id,
      role: invite.role,
      joinedAt: now,
    });

    await tx
      .update(householdInvites)
      .set({ acceptedAt: now })
      .where(eq(householdInvites.id, invite.id));
  });

  return { ok: true, householdName: invite.householdName, role: invite.role };
}
