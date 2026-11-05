import 'server-only';
import { eq } from 'drizzle-orm';

import { getDb, users } from '@pradomotica/db';
import { auth } from './auth';

/**
 * Cuenta con acceso a las secciones de *plataforma* (no de hogar).
 *
 * Los roles de `household_members` (owner/admin/viewer) sólo gobiernan un hogar
 * concreto. Esto es otra cosa: secciones que no pertenecen a ningún hogar y que
 * sólo debe ver el dueño de la instalación.
 */
export const SUPER_ADMIN_EMAIL = 'user@example.com';

/** True si el usuario es super admin, por flag en BD o por email semilla. */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  const [u] = await db
    .select({ email: users.email, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return false;
  return u.isAdmin || u.email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

/**
 * Devuelve la sesión sólo si pertenece a un super admin, y `null` en cualquier
 * otro caso. Pensada para usarse en layouts, server actions y route handlers:
 * ocultar el enlace en la nav no es una medida de seguridad.
 */
export async function getSuperAdminSession() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return (await isSuperAdmin(session.user.id)) ? session : null;
}
