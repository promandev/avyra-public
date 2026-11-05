'use server';

import { and, desc, eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId } from '@/lib/household';
import type { VacuumSession } from '@/lib/vacuum';
import { getDb, devices, vacuums, vacuumSessions } from '@pradomotica/db';

/** Lo que cabe con holgura en la lista plegable de la tarjeta. */
const MAX_SESSIONS = 30;

export async function getVacuumSessions(deviceId: string): Promise<VacuumSession[]> {
  const session = await auth();
  if (!session?.user?.id || typeof deviceId !== 'string') return [];

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return [];

  const db = getDb();
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .innerJoin(vacuums, eq(vacuums.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return [];

  const rows = await db
    .select()
    .from(vacuumSessions)
    .where(eq(vacuumSessions.deviceId, deviceId))
    .orderBy(desc(vacuumSessions.startedAt))
    .limit(MAX_SESSIONS);

  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    batteryStart: r.batteryStart,
    batteryEnd: r.batteryEnd,
    // Se calcula del intervalo y no de la columna: las filas antiguas guardaron
    // el contador del robot, que se quedaba muy corto.
    cleanMinutes: Math.round(
      ((r.endedAt ?? r.lastActiveAt).getTime() - r.startedAt.getTime()) / 60_000,
    ),
    cleanArea: r.cleanArea,
    endState: r.endState,
  }));
}
