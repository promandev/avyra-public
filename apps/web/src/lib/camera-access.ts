import { eq, and } from 'drizzle-orm';

import { getDb, cameras, devices, householdMembers, users } from '@pradomotica/db';
import { SUPER_ADMIN_EMAIL } from './super-admin';

/** Only this account may see or stream tablet-camera devices. Same identity as the platform super admin. */
export const ADMIN_EMAIL = SUPER_ADMIN_EMAIL;

/**
 * Valor de `cameras.model` que marca a la cámara de la tablet.
 *
 * Es lo único que la distingue de una cámara normal, y de ello dependen tanto
 * el gesto secreto que la revela como el hecho de que no aparezca en ningún
 * recuento. Estaba escrito a mano en media docena de sitios; vive aquí para
 * que no se vuelva a olvidar en uno de ellos.
 */
export const TABLET_CAMERA_MODEL = 'Tablet';

/**
 * Verifies the user belongs to the household that owns this camera device.
 * Tablet cameras are additionally restricted to ADMIN_EMAIL, regardless of
 * household membership — the UI already hides them from everyone else, and
 * this makes that restriction hold at the API level too.
 */
export async function verifyCameraAccess(deviceId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const [device] = await db
    .select({ householdId: devices.householdId, model: cameras.model })
    .from(devices)
    .innerJoin(cameras, eq(cameras.deviceId, devices.id))
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (!device) return false;

  const [membership] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, device.householdId),
        eq(householdMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!membership) return false;

  if (device.model === TABLET_CAMERA_MODEL) {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (user?.email !== ADMIN_EMAIL) return false;
  }

  return true;
}
