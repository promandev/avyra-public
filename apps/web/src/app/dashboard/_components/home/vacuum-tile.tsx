import { getTranslations } from 'next-intl/server';

import { VacuumIcon } from '@/components/vacuum-icon';
import type { VacuumOverview } from '@/lib/home-pulse-types';
import { Tile } from './tile';

/**
 * Estado del robot aspirador: qué está haciendo y cuánta batería le queda.
 *
 * La batería es un anillo porque es la pregunta que se hace al pasar ("¿le da
 * para otra pasada?"). Mientras limpia, el anillo gira despacio: se nota desde
 * lejos sin tener que leer nada.
 */

const SIZE = 64;
const STROKE = 6;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

/** Estados que Home Assistant usa para la entidad vacuum y tienen texto propio. */
const KNOWN = new Set(['cleaning', 'docked', 'returning', 'paused', 'idle', 'error', 'unavailable']);

function VacuumRow({
  vacuum,
  statusLabel,
  batteryLabel,
}: {
  vacuum: VacuumOverview;
  statusLabel: string;
  batteryLabel: string;
}) {
  const cleaning = vacuum.state === 'cleaning';
  const returning = vacuum.state === 'returning';
  const error = vacuum.state === 'error';
  const level = vacuum.battery ?? 0;

  const ring = error
    ? 'stroke-destructive'
    : cleaning || returning
      ? 'stroke-state-live'
      : level <= 20
        ? 'stroke-state-heat'
        : 'stroke-foreground/60';

  const chip = error
    ? 'bg-destructive/15 text-destructive'
    : cleaning || returning
      ? 'bg-state-live/15 text-state-live-fg'
      : 'bg-muted/60 text-muted-foreground';

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={`h-full w-full -rotate-90 ${cleaning ? 'animate-[spin_6s_linear_infinite]' : ''}`}
          aria-hidden="true"
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className="stroke-muted" />
          {vacuum.battery !== null && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              className={`transition-all duration-700 ${ring}`}
              strokeDasharray={`${(CIRC * level) / 100} ${CIRC}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <VacuumIcon className={`size-6 ${cleaning ? 'text-state-live' : 'text-muted-foreground'}`} />
        </div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <p className="truncate font-medium">{vacuum.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chip}`}>{statusLabel}</span>
          {vacuum.battery !== null && (
            <span className="tnum text-xs text-muted-foreground">
              {batteryLabel} {vacuum.battery}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export async function VacuumTile({ vacuums, className }: { vacuums: VacuumOverview[]; className?: string }) {
  const t = await getTranslations('dashboard.tiles');
  const tv = await getTranslations('vacuum');

  return (
    <Tile title={t('vacuum')} icon={VacuumIcon} href="/dashboard/vacuum" hrefLabel={t('seeAll')} className={className}>
      <div className="flex flex-1 flex-col justify-center gap-5">
        {vacuums.map((vacuum) => {
          const key = KNOWN.has(vacuum.state) ? vacuum.state : 'unknown';
          return (
            <VacuumRow
              key={vacuum.id}
              vacuum={vacuum}
              statusLabel={tv(`status_${key}` as Parameters<typeof tv>[0])}
              batteryLabel={tv('battery')}
            />
          );
        })}
      </div>
    </Tile>
  );
}
