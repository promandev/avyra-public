import { notFound } from 'next/navigation';

import { getSuperAdminSession } from '@/lib/super-admin';

/**
 * Puerta del registro de fallos de cámara. 404 en vez de 403 para no confirmar
 * que la ruta existe a quien no debe verla (mismo criterio que Streaming).
 */
export default async function CameraLogLayout({ children }: { children: React.ReactNode }) {
  const session = await getSuperAdminSession();
  if (!session) notFound();
  return <>{children}</>;
}
