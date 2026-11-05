import 'server-only';

import { auth } from './auth';
import { getActiveHouseholdRole } from './household';

/**
 * Puerta de la sección Impresora: cualquier miembro de un hogar, sea cual sea
 * su rol, igual que el aspirador. Devuelve la sesión o `null`.
 *
 * La usan el layout y las rutas de `/api/printer`: ocultar el enlace no protege nada.
 */
export async function getPrinterSession() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return (await getActiveHouseholdRole(session.user.id)) ? session : null;
}
