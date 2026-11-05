'use server';

import { and, eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId } from '@/lib/household';
import type { LitterDayData } from '@/lib/litter';
import { loadLitterDay } from '@/lib/litter-data';
import { isDayString } from '@/lib/madrid-time';
import { getDb, devices, litterBoxes } from '@pradomotica/db';

/** Visitas y resumen de un día de casa, para cualquier miembro del hogar. */
export async function getLitterDay(deviceId: string, day: string): Promise<LitterDayData | null> {
  const session = await auth();
  if (!session?.user?.id || typeof deviceId !== 'string' || !isDayString(day)) return null;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return null;

  const [box] = await getDb()
    .select({ id: devices.id })
    .from(devices)
    .innerJoin(litterBoxes, eq(litterBoxes.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!box) return null;

  return loadLitterDay(deviceId, householdId, day);
}
