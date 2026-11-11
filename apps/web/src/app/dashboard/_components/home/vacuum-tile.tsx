import { getTranslations } from 'next-intl/server';

import { VacuumIcon } from '@/components/vacuum-icon';
import type { VacuumOverview } from '@/lib/home-pulse-types';
import { Section } from './section';

/**
 * Estado del robot aspirador: qué está haciendo y cuánta batería le queda.
 *
 * La batería va en cifra porque es la pregunta que se hace al pasar ("¿le da
 * para otra pasada?"). Mientras limpia, la pieza se tiñe de verde, igual que
 * el clima se tiñe al dar servicio.
 */

/** Estados que Home Assistant usa para la entidad vacuum y tienen texto propio. */
const KNOWN = new Set(['cleaning', 'docked', 'returning', 'paused', 'idle', 'error', 'unavailable']);

export async function VacuumTile({ vacuums, className }: { vacuums: VacuumOverview[]; className?: string }) {
  const t = await getTranslations('dashboard.tiles');
  const tv = await getTranslations('vacuum');

  return (
    <Section title={t('vacuum')} href="/dashboard/vacuum" hrefLabel={t('seeAll')} className={className}>
      <ul className="grid gap-3">
        {vacuums.map((vacuum) => {
          const key = KNOWN.has(vacuum.state) ? vacuum.state : 'unknown';
          const working = vacuum.state === 'cleaning' || vacuum.state === 'returning';
          const error = vacuum.state === 'error';
          const low = vacuum.battery !== null && vacuum.battery <= 20;

          return (
            <li
              key={vacuum.id}
              className={[
                'surface flex min-h-[4.5rem] items-center gap-4 rounded-3xl px-5 py-4',
                working ? 'border-state-live/45 bg-state-live/10' : '',
                error ? 'border-destructive/50 bg-destructive/10' : '',
              ].join(' ')}
            >
              <VacuumIcon
                className={`size-6 shrink-0 ${working ? 'text-state-live-fg' : error ? 'text-destructive' : 'text-muted-foreground'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-snug">{vacuum.name}</span>
                <span
                  className={[
                    'block truncate text-sm leading-snug',
                    working
                      ? 'font-medium text-state-live-fg'
                      : error
                        ? 'font-medium text-destructive'
                        : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {tv(`status_${key}` as Parameters<typeof tv>[0])}
                </span>
              </span>
              {vacuum.battery !== null && (
                <span className="shrink-0 text-right">
                  <span
                    className={`tnum block text-2xl font-semibold leading-none tracking-tight ${low ? 'text-[hsl(356_75%_38%)] dark:text-destructive' : ''}`}
                  >
                    {vacuum.battery}
                    <span className="ml-0.5 text-base font-medium">%</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{tv('battery')}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
