import { Thermometer } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import type { ClimateOverview } from '@/lib/home-pulse-types';
import { ClimateDial } from './climate-dial';
import { Tile } from './tile';

/**
 * Clima de cada estancia en un dial.
 *
 * Calefacción y aire van juntos porque son la misma pregunta ("¿qué temperatura
 * hay y a cuánto va?"); el color del dial ya distingue uno de otro. Con muchos
 * aparatos los diales bajan a una fila nueva en vez de apretarse.
 */
/* Clases literales: Tailwind tiene que poder verlas enteras. */
function gridFor(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2 || count === 4) return 'grid-cols-2';
  return 'grid-cols-2 sm:grid-cols-3';
}

export async function ClimateTile({ devices, className }: { devices: ClimateOverview[]; className?: string }) {
  const t = await getTranslations('dashboard.tiles');
  const locale = await getLocale();

  // El enlace lleva a la sección con más aparatos del mosaico.
  const heating = devices.filter((d) => d.kind === 'heat').length;
  const href = heating >= devices.length - heating ? '/dashboard/heating' : '/dashboard/ac';

  return (
    <Tile title={t('climate')} icon={Thermometer} href={href} hrefLabel={t('seeAll')} className={className}>
      {/* Columnas según cuántos diales hay, para que ninguna fila quede coja:
          cuatro van en 2×2 y no en 3+1. Una fila desplazable, que era lo
          primero que se probó, escondía los últimos diales sin que se notase. */}
      <div className={`grid flex-1 place-items-center gap-x-4 gap-y-7 ${gridFor(devices.length)}`}>
        {devices.map((device) => (
          <ClimateDial
            key={device.id}
            device={device}
            locale={locale}
            labels={{
              running: device.kind === 'heat' ? t('heating') : t('cooling'),
              standby: t('standby'),
              off: t('off'),
              noData: t('noData'),
              // Se pide con el marcador literal y el dial lo sustituye: así el número
              // se formatea con la configuración regional del propio dial.
              target: t('target', { temp: '{temp}' }),
            }}
          />
        ))}
      </div>
    </Tile>
  );
}
