import 'server-only';

import { auth } from './auth';
import { getActiveHouseholdId, getActiveHouseholdRole } from './household';

/**
 * Puerta de la sección Lista de la compra: cualquier miembro de un hogar, sea
 * cual sea su rol, como la impresora. Devuelve la sesión o `null`.
 *
 * La usan el layout y las rutas de `/api/shopping`: ocultar el enlace no protege nada.
 */
export async function getShoppingSession() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return (await getActiveHouseholdRole(session.user.id)) ? session : null;
}

/**
 * Como `getShoppingSession`, más el hogar activo y si el usuario puede cambiar
 * la configuración de la sección (el orden de las listas): propietario o admin.
 */
export async function getShoppingAccess() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [householdId, role] = await Promise.all([
    getActiveHouseholdId(session.user.id),
    getActiveHouseholdRole(session.user.id),
  ]);
  if (!householdId || !role) return null;
  return { session, householdId, canManage: role === 'owner' || role === 'admin' };
}
