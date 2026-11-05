import 'server-only';
import webPush from 'web-push';
import { and, eq } from 'drizzle-orm';

import { getDb, devicePushPrefs, pushSubscriptions, users } from '@pradomotica/db';
import { env } from './env';
import { devicePushDefault, type PushCategory } from './push-categories';

export type { PushCategory };

/**
 * Columna de `users` que silencia cada categoría. El interruptor general manda
 * sobre todas: si está apagado no sale nada.
 *
 * Un aviso sin categoría se manda siempre (mientras el general esté encendido),
 * para que una alerta nueva no se pierda por olvidar añadirla aquí.
 */
const CATEGORY_COLUMN = {
  cameras: users.pushCameras,
  lights: users.pushLights,
  vacuum: users.pushVacuum,
  litter: users.pushLitter,
  heating: users.pushHeating,
  ac: users.pushAc,
  printer: users.pushPrinter,
} as const;

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  /**
   * Agrupa los avisos del mismo aparato: el nuevo sustituye al anterior en la
   * bandeja en lugar de apilarse. Sin esto, una luz que se enciende y se apaga
   * varias veces deja media pantalla de notificaciones.
   */
  tag?: string;
}

/**
 * ¿Quiere este usuario avisos de este aparato? Sin preferencia guardada manda
 * el valor por defecto de la categoría. Si la tabla aún no existe (migración
 * pendiente) también: mejor un aviso de más que dejar de avisar de todo.
 */
async function isDevicePushEnabled(
  userId: string,
  deviceId: string,
  category: PushCategory | undefined,
): Promise<boolean> {
  try {
    const [row] = await getDb()
      .select({ enabled: devicePushPrefs.enabled })
      .from(devicePushPrefs)
      .where(and(eq(devicePushPrefs.userId, userId), eq(devicePushPrefs.deviceId, deviceId)))
      .limit(1);
    if (row) return row.enabled;
  } catch (err) {
    console.error('[push] device prefs lookup failed:', err instanceof Error ? err.message : err);
  }
  return category ? devicePushDefault(category) : true;
}

/**
 * Envía una notificación push a todos los dispositivos registrados de un usuario.
 * Las suscripciones inválidas (expiradas, desregistradas) se eliminan automáticamente.
 *
 * Con `deviceId`, además respeta el interruptor de avisos de ese aparato.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  category?: PushCategory,
  deviceId?: string,
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    console.warn('[push] VAPID keys not configured — skipping notification');
    return;
  }

  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const db = getDb();

  // Interruptor de administrador: si está desactivado para este usuario, no enviar.
  // La categoría se lee en la misma consulta para no pagar dos idas a la base.
  const [userRow] = await db
    .select({
      pushEnabled: users.pushEnabled,
      categoryEnabled: category ? CATEGORY_COLUMN[category] : users.pushEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!userRow?.pushEnabled) return;
  if (category && !userRow.categoryEnabled) return;
  if (deviceId && !(await isDevicePushEnabled(userId, deviceId, category))) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  if (subs.length === 0) return;

  const body = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 60 * 60 }, // 1 hour
      ),
    ),
  );

  // Limpia suscripciones que ya no son válidas (410 Gone, 404).
  const stale: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const statusCode = (r.reason as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        stale.push(subs[i]!.id);
      }
    }
  });

  if (stale.length > 0) {
    for (const id of stale) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
    }
    console.log(`[push] Removed ${stale.length} stale subscription(s)`);
  }
}

/**
 * Envía una notificación push a TODOS los miembros de un household.
 */
export async function sendPushToHousehold(
  householdId: string,
  payload: PushPayload,
  category?: PushCategory,
  deviceId?: string,
) {
  const db = getDb();
  const { householdMembers } = await import('@pradomotica/db');

  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));

  await Promise.allSettled(members.map((m) => sendPushToUser(m.userId, payload, category, deviceId)));
}
