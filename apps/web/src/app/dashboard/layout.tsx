import { redirect } from 'next/navigation';

import { auth, signOut } from '@/lib/auth';
import { getUserHouseholds, getActiveHouseholdId } from '@/lib/household';
import { getHomePulse } from '@/lib/home-pulse';
import { isSuperAdmin } from '@/lib/super-admin';
import { switchHousehold } from './settings/actions';
import { BackButton } from '@/components/back-button';
import { AmbientBackdrop } from './_components/ambient-backdrop';
import { DashboardNav } from './_components/dashboard-nav';
import { APP_VERSION } from '@/lib/version';
import { MAIN_SCROLL_ID } from '@/lib/scroll-target';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  const [allHouseholds, activeHouseholdId, superAdmin] = await Promise.all([
    getUserHouseholds(session.user.id!),
    getActiveHouseholdId(session.user.id!),
    isSuperAdmin(session.user.id!),
  ]);

  // El pulso tiñe el fondo y enciende los puntos del menú. Tiene su propio
  // techo de espera, así que no puede retrasar la navegación aunque Home
  // Assistant esté caído.
  const pulse = await getHomePulse(activeHouseholdId);

  const logoutAction = async () => {
    'use server';
    await signOut({ redirectTo: '/login' });
  };

  return (
    // En escritorio, dos paneles a altura de pantalla: la barra no se mueve y
    // el scroll vive dentro de la sección. En móvil no hay barra lateral (es
    // una cabecera fija más un cajón), así que se deja desplazar la página
    // entera: encerrar el scroll ahí pelea con la barra del navegador.
    <div className="md:grid md:h-dvh md:grid-cols-[264px_1fr] md:overflow-hidden">
      <AmbientBackdrop pulse={pulse} />

      <DashboardNav
        email={session.user.email!}
        logoutAction={logoutAction}
        households={allHouseholds}
        activeHouseholdId={activeHouseholdId ?? allHouseholds[0]?.id ?? ''}
        switchHouseholdAction={switchHousehold}
        version={APP_VERSION}
        isSuperAdmin={superAdmin}
        pulse={pulse}
      />

      {/* El id lo usa BackToTop para saber qué contenedor desplazar. */}
      <main
        id={MAIN_SCROLL_ID}
        className="styled-scrollbar overflow-x-hidden pt-14 md:h-dvh md:overflow-y-auto md:pt-0"
      >
        <BackButton />
        {children}
      </main>
    </div>
  );
}
