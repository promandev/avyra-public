import { notFound } from 'next/navigation';

import { getSuperAdminSession } from '@/lib/super-admin';

/**
 * Puerta de la sección. 404 en vez de 403 para no confirmar que la ruta existe
 * a quien no debe verla. Las rutas de `/api/system` repiten la comprobación por
 * su cuenta: esto sólo protege el render.
 */
export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const session = await getSuperAdminSession();
  if (!session) notFound();
  return <>{children}</>;
}
