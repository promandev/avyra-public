import { cache, Suspense } from 'react';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId } from '@/lib/household';
import { getHouseOverview } from '@/lib/home-pulse';
import { getWeatherForLocation } from '@/lib/weather';
import { getDb, households } from '@pradomotica/db';
import { HomeView } from './_components/home/home-view';
import { Section } from './_components/home/section';
import { WeatherWidget } from './_components/weather-widget';

/**
 * El tiempo se consulta una sola vez por petición gracias a `cache`.
 */
const loadWeather = cache(async (address: string | null) =>
  address ? getWeatherForLocation(address) : null,
);

async function WeatherDetailSection({ address }: { address: string | null }) {
  const weather = await loadWeather(address);
  const t = await getTranslations('dashboard');
  return (
    <Section title={t('weatherSection')}>
      <WeatherWidget weather={weather} hasAddress={!!address} />
    </Section>
  );
}

/**
 * Portada del panel. La composición vive en `HomeView`; aquí sólo se resuelve
 * quién mira, qué hogar tiene activo y dónde está para el tiempo.
 */
export default async function DashboardPage() {
  const session = await auth();

  const activeId = session?.user?.id ? await getActiveHouseholdId(session.user.id) : null;

  let address: string | null = null;
  if (activeId) {
    const db = getDb();
    const [hh] = await db
      .select({ address: households.address })
      .from(households)
      .where(eq(households.id, activeId))
      .limit(1);
    address = hh?.address ?? null;
  }

  // Misma lectura que el layout (fondo y menú): `cache` evita repetirla.
  const overview = await getHouseOverview(activeId);

  return (
    <HomeView name={session?.user.name ?? session?.user.email ?? ''} overview={overview}>
      <Suspense fallback={null}>
        <WeatherDetailSection address={address} />
      </Suspense>
    </HomeView>
  );
}
