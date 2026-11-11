import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { HouseOverview } from '@/lib/home-pulse-types';
import { HomeHero } from '../home-hero';
import { CamerasTile } from './cameras-tile';
import { ClimateCards } from './climate-cards';
import { LightsTileBody } from './lights-tile';
import { Section } from './section';
import { VacuumTile } from './vacuum-tile';

/**
 * Portada del panel.
 *
 * Arriba, la casa contada en una frase. Debajo, cada aparato como uno más de
 * su tipo, con su cifra o su interruptor: el clima de cada termostato, las
 * luces (que se pueden tocar), el último aviso de cada cámara (nunca su
 * imagen: la portada queda a la vista de cualquiera) y cómo va el robot. Los
 * grupos sin aparatos no se pintan y los que quedan se reparten el ancho.
 */
export async function HomeView({
  name,
  overview,
  children,
}: {
  name: string;
  overview: HouseOverview;
  /** Lo que va debajo de los aparatos (el tiempo). */
  children?: ReactNode;
}) {
  const t = await getTranslations('dashboard.tiles');

  const hasClimate = overview.climate.length > 0;
  const hasCameras = overview.cameras.length > 0;
  const hasLights = overview.lights.length > 0;
  const hasVacuum = overview.vacuums.length > 0;
  const hasSide = hasCameras || hasVacuum;

  // "Ver todo" sólo si todo el clima vive en una misma sección; con
  // calefacción y aire mezclados cada pieza ya enlaza a la suya.
  const kinds = new Set(overview.climate.map((d) => d.kind));
  const climateHref =
    kinds.size === 1 ? (kinds.has('heat') ? '/dashboard/heating' : '/dashboard/ac') : undefined;
  const lightsOn = overview.lights.filter((l) => l.on).length;

  return (
    <div className="container space-y-10 py-8 md:space-y-12 md:px-8 md:py-12 xl:px-10">
      <HomeHero name={name} overview={overview} />

      {hasClimate && (
        <Section
          title={t('climate')}
          href={climateHref}
          hrefLabel={t('seeAll')}
        >
          <ClimateCards devices={overview.climate} />
        </Section>
      )}

      {(hasLights || hasSide) && (
        <div
          className={[
            'grid gap-10 md:gap-12',
            hasLights && hasSide ? 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-10' : '',
          ].join(' ')}
        >
          {hasLights && (
            <Section
              title={t('lights')}
              meta={`${lightsOn}/${overview.lights.length}`}
              href="/dashboard/lights"
              hrefLabel={t('seeAll')}
            >
              <LightsTileBody lights={overview.lights} wide={!hasSide} />
            </Section>
          )}

          {hasSide && (
            <div className="grid content-start gap-10">
              {hasCameras && <CamerasTile cameras={overview.cameras} />}
              {hasVacuum && <VacuumTile vacuums={overview.vacuums} />}
            </div>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
