import { notFound } from 'next/navigation';

import { getSuperAdminSession } from '@/lib/super-admin';

/**
 * Puerta de la sección. 404 en vez de 403 para no confirmar que la ruta existe
 * a quien no debe verla. La bóveda en sí tiene su propio login con contraseña
 * maestra: esto sólo protege la página de supervisión.
 */
export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  const session = await getSuperAdminSession();
  if (!session) notFound();
  return <>{children}</>;
}
