import Link from 'next/link';
import type { Route } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import type { ClimateOverview } from '@/lib/home-pulse-types';

/**
 * Clima: una pieza por aparato, calefacción y aire juntos.
 *
 * Cada una responde a la misma pregunta ("¿qué temperatura hay y a cuánto
 * va?") con una cifra grande y una línea de estado. El color sólo aparece
 * cuando el aparato está dando servicio, que es la misma regla que tiñe el
 * fondo: encendido pero en espera se queda neutro. Todas tienen el mismo
 * tamaño y las cifras son tabulares, así que se comparan de un vistazo.
 */

/* Clases literales: Tailwind tiene que poder verlas enteras. */
const CARD_TONE = {
  heat: 'border-state-heat/45 bg-state-heat/10 hover:bg-state-heat/[0.14]',
  cool: 'border-state-cool/45 bg-state-cool/10 hover:bg-state-cool/[0.14]',
  idle: 'hover:bg-accent/60',
};

const STATUS_TONE = {
  heat: 'font-medium text-state-heat-fg',
  cool: 'font-medium text-state-cool-fg',
  idle: 'text-muted-foreground',
};

export async function ClimateCards({ devices }: { devices: ClimateOverview[] }) {
  const t = await getTranslations('dashboard.tiles');
  const locale = await getLocale();
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {devices.map((device) => {
        const hasReading = device.current !== null;
        const tone = device.power && device.running ? device.kind : 'idle';

        const status = !hasReading
          ? t('noData')
          : !device.power
            ? t('off')
            : device.running
              ? device.kind === 'heat'
                ? t('heating')
                : t('cooling')
              : t('standby');
        // En marcha se dice a cuánto va ("Calentando hasta 21,5°"); en espera
        // basta la consigna.
        const target =
          !device.power || device.target === null
            ? null
            : device.running
              ? ` ${t('target', { temp: fmt.format(device.target) })}`
              : ` · ${fmt.format(device.target)}°`;

        return (
          <li key={device.id}>
            <Link
              href={(device.kind === 'heat' ? '/dashboard/heating' : '/dashboard/ac') as Route}
              className={[
                'surface flex min-h-[4.75rem] items-center justify-between gap-4 rounded-3xl px-5 py-3 sm:min-h-[6.5rem] sm:py-4',
                'transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                CARD_TONE[tone],
              ].join(' ')}
            >
              <span className="min-w-0">
                <span className="line-clamp-2 break-words font-medium leading-snug">{device.name}</span>
                <span className={`tnum mt-1 block text-sm leading-snug ${STATUS_TONE[tone]}`}>
                  {status}
                  {target}
                </span>
              </span>
              <span
                className={[
                  'tnum shrink-0 text-4xl font-semibold sm:text-5xl leading-none tracking-[-0.04em]',
                  device.power ? '' : 'text-muted-foreground',
                ].join(' ')}
              >
                {hasReading ? `${fmt.format(device.current!)}°` : '—'}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
