import 'server-only';
import { cookies } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { getDb, householdMembers, households } from '@pradomotica/db';
import type { HouseholdRole } from '@pradomotica/db';

const COOKIE_NAME = 'pradomotica.household';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 1 year
};

export type UserHousehold = {
  id: string;
  name: string;
  role: HouseholdRole;
};

/**
 * Returns all households the user belongs to, ordered by join date.
 */
export async function getUserHouseholds(userId: string): Promise<UserHousehold[]> {
  const db = getDb();
  return db
    .select({
      id: households.id,
      name: households.name,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .orderBy(householdMembers.invitedAt);
}

/**
 * Returns the active household ID for the user.
 * Priority: cookie value (if still valid member) → first household.
 */
export async function getActiveHouseholdId(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const stored = cookieStore.get(COOKIE_NAME)?.value;
  const db = getDb();

  if (stored) {
    const [member] = await db
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, userId),
          eq(householdMembers.householdId, stored),
        ),
      )
      .limit(1);
    if (member) return member.householdId;
  }

  // Fall back to first household
  const [first] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);

  return first?.householdId ?? null;
}

/**
 * Returns the user's role in the active household, or null if not a member.
 */
export async function getActiveHouseholdRole(userId: string): Promise<HouseholdRole | null> {
  const householdId = await getActiveHouseholdId(userId);
  if (!householdId) return null;

  const db = getDb();
  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, userId),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .limit(1);

  return member?.role ?? null;
}

/**
 * Checks if the user has one of the required roles in their active household.
 */
export async function requireRole(
  userId: string,
  requiredRoles: HouseholdRole[] = ['owner', 'admin'],
): Promise<boolean> {
  const role = await getActiveHouseholdRole(userId);
  if (!role) return false;
  return requiredRoles.includes(role);
}

/**
 * Persists the active household selection in a cookie (server-side only).
 * Call from a server action after validating membership.
 */
export async function persistActiveHousehold(householdId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, householdId, {
    ...COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
  });
}
