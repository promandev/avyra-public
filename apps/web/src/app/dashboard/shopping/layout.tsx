import { notFound } from 'next/navigation';

import { getShoppingSession } from '@/lib/shopping-access';

/**
 * Puerta de la sección: cualquier miembro del hogar, sea cual sea su rol. Las
 * rutas de `/api/shopping` repiten la comprobación: esto sólo protege el render.
 */
export default async function ShoppingLayout({ children }: { children: React.ReactNode }) {
  const session = await getShoppingSession();
  if (!session) notFound();
  return <>{children}</>;
}
