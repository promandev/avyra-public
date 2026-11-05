'use server';

import { and, eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId } from '@/lib/household';
import { getDb, devicePushPrefs, devices } from '@pradomotica/db';

/**
 * Activa o silencia los avisos push de un aparato para el usuario actual.
 * Es una preferencia personal: no hace falta ser administrador del hogar.
 */
export async function setDevicePush(
  deviceId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'No autenticado' };
  if (typeof enabled !== 'boolean') return { error: 'Datos inválidos' };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: 'No hay hogar configurado' };

  const db = getDb();
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return { error: 'Dispositivo no encontrado' };

  try {
    await db
      .insert(devicePushPrefs)
      .values({ userId: session.user.id, deviceId, enabled, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [devicePushPrefs.userId, devicePushPrefs.deviceId],
        set: { enabled, updatedAt: new Date() },
      });
  } catch (err) {
    console.error('[setDevicePush] DB error:', err);
    return { error: 'No se pudo guardar' };
  }

  return {};
}
