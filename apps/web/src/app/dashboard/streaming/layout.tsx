import { notFound } from 'next/navigation';

import { getSuperAdminSession } from '@/lib/super-admin';

/**
 * Puerta de la sección. Devuelve 404 en vez de 403 para no confirmar que la
 * ruta existe a quien no debe verla. Las rutas de `/api/streaming` repiten la
 * comprobación por su cuenta: esto sólo protege el render.
 */
export default async function StreamingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSuperAdminSession();
  if (!session) notFound();
  return <>{children}</>;
}
