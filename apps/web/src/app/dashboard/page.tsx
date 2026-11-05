import { cache, Suspense } from 'react';
import { eq } from 'drizzle-orm';
import { Lightbulb } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId } from '@/lib/household';
import { getHouseOverview } from '@/lib/home-pulse';
import { getWeatherForLocation } from '@/lib/weather';
import { getDb, households } from '@pradomotica/db';
import { HomeHero } from './_components/home-hero';
import { CamerasTile } from './_components/home/cameras-tile';
import { ClimateTile } from './_components/home/climate-tile';
import { LightsTileBody } from './_components/home/lights-tile';
import { Tile } from './_components/home/tile';
import { VacuumTile } from './_components/home/vacuum-tile';
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
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {t('weatherSection')}
      </h2>
      <WeatherWidget weather={weather} hasAddress={!!address} />
    </section>
  );
}

/**
 * Portada en mosaico.
 *
 * Arriba, la casa contada en una frase. Debajo, una pieza por cosa
 * que se consulta a diario, cada una con el detalle vivo y no sólo un número:
 * el dial de cada estancia, el último aviso de cada cámara (nunca su imagen: la
 * portada queda a la vista de cualquiera), qué luces están encendidas
 * (y se pueden tocar), cómo va el robot. Las piezas sin aparatos no se pintan,
 * y las que quedan reparten el ancho para que las filas no queden cojas.
 */
export default async function DashboardPage() {
  const session = await auth();
  const t = await getTranslations('dashboard.tiles');

  const activeId = session?.user?.id ? await getActiveHouseholdId(session.user.id) : null;

  let address: string | null = null;
  let householdName: string | null = null;
  if (activeId) {
    const db = getDb();
    const [hh] = await db
      .select({ address: households.address, name: households.name })
      .from(households)
      .where(eq(households.id, activeId))
      .limit(1);
    address = hh?.address ?? null;
    householdName = hh?.name ?? null;
  }

  // Misma lectura que el layout (fondo y menú): `cache` evita repetirla.
  const overview = await getHouseOverview(activeId);

  const hasClimate = overview.climate.length > 0;
  const hasCameras = overview.cameras.length > 0;
  const hasLights = overview.lights.length > 0;
  const hasVacuum = overview.vacuums.length > 0;

  return (
    <div className="container space-y-10 py-8 md:py-12">
      <div className="stagger grid gap-4 md:gap-5 xl:grid-cols-12">
        <HomeHero
          name={session?.user.name ?? session?.user.email ?? ''}
          householdName={householdName}
          overview={overview}
          className="xl:col-span-12"
        />

        {hasClimate && (
          <ClimateTile devices={overview.climate} className={hasCameras ? 'xl:col-span-7' : 'xl:col-span-12'} />
        )}

        {hasCameras && (
          <CamerasTile cameras={overview.cameras} className={hasClimate ? 'xl:col-span-5' : 'xl:col-span-12'} />
        )}

        {hasLights && (
          <Tile
            title={t('lights')}
            icon={Lightbulb}
            href="/dashboard/lights"
            hrefLabel={t('seeAll')}
            className={hasVacuum ? 'xl:col-span-7' : 'xl:col-span-12'}
          >
            <LightsTileBody lights={overview.lights} />
          </Tile>
        )}

        {hasVacuum && (
          <VacuumTile vacuums={overview.vacuums} className={hasLights ? 'xl:col-span-5' : 'xl:col-span-12'} />
        )}
      </div>

      <Suspense fallback={null}>
        <WeatherDetailSection address={address} />
      </Suspense>
    </div>
  );
}
