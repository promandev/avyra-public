import { notFound } from 'next/navigation';

import { getPrinterSession } from '@/lib/printer-access';

/**
 * Puerta de la sección: cualquier miembro del hogar, sea cual sea su rol. Las
 * rutas de `/api/printer` repiten la comprobación: esto sólo protege el render.
 */
export default async function PrinterLayout({ children }: { children: React.ReactNode }) {
  const session = await getPrinterSession();
  if (!session) notFound();
  return <>{children}</>;
}
