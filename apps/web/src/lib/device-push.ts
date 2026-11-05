import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { getDb, devicePushPrefs } from '@pradomotica/db';
import { devicePushDefault, type PushCategory } from './push-categories';

/**
 * Estado del interruptor de avisos de cada aparato para un usuario, ya con el
 * valor por defecto de la categoría aplicado a los que nunca se han tocado.
 *
 * Si la consulta falla (tabla aún sin migrar) se pintan los valores por
 * defecto, que es exactamente lo que hará el envío en ese caso.
 */
export async function getDevicePushPrefs(
  userId: string,
  deviceIds: string[],
  category: PushCategory,
): Promise<Record<string, boolean>> {
  const fallback = devicePushDefault(category);
  const out: Record<string, boolean> = Object.fromEntries(deviceIds.map((id) => [id, fallback]));
  if (deviceIds.length === 0) return out;

  try {
    const rows = await getDb()
      .select({ deviceId: devicePushPrefs.deviceId, enabled: devicePushPrefs.enabled })
      .from(devicePushPrefs)
      .where(and(eq(devicePushPrefs.userId, userId), inArray(devicePushPrefs.deviceId, deviceIds)));
    for (const row of rows) out[row.deviceId] = row.enabled;
  } catch (err) {
    console.error('[device-push] prefs lookup failed:', err instanceof Error ? err.message : err);
  }
  return out;
}
