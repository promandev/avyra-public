import Link from 'next/link';
import type { Route } from 'next';
import { Camera, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import type { CameraOverview } from '@/lib/home-pulse-types';
import { Tile } from './tile';

/**
 * Cámaras en la portada, SIN imagen.
 *
 * La portada es lo primero que se abre y se deja a la vista de quien pase; no
 * debe enseñar nada de lo que ven las cámaras, ni en directo ni en captura.
 * Lo que cuenta de cada una es si está activa y cuándo avisó por última vez.
 * Para mirar hay que entrar a propósito en la sección.
 */

const EVENT_KEY: Record<string, string> = {
  motion: 'eventMotion',
  sound: 'eventSound',
  human: 'eventHuman',
  animal: 'eventAnimal',
};

/** "hace 12 min", "hace 3 h", "hace 2 días", en el idioma de quien mira. */
function relativeTime(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

/** Un aviso de menos de 15 minutos se destaca: es lo que quizá interese mirar. */
const RECENT_MS = 15 * 60 * 1000;

export async function CamerasTile({ cameras, className }: { cameras: CameraOverview[]; className?: string }) {
  const t = await getTranslations('dashboard.tiles');
  const locale = await getLocale();

  const active = cameras.filter((c) => c.enabled).length;
  // Cámara con el aviso más reciente, si cae dentro de la ventana de "reciente".
  const latest = cameras
    .filter((c) => c.enabled && c.lastEventAt)
    .sort((a, b) => new Date(b.lastEventAt!).getTime() - new Date(a.lastEventAt!).getTime())[0];
  const recentCamera =
    latest && Date.now() - new Date(latest.lastEventAt!).getTime() < RECENT_MS ? latest : null;

  return (
    <Tile title={t('cameras')} icon={Camera} href="/dashboard/cameras" hrefLabel={t('seeAll')} className={className}>
      {/* Estado de conjunto: cuántas vigilan y si alguna ha avisado hace poco. */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="tnum text-4xl font-semibold leading-none tracking-tight">
            {active}
            <span className="text-lg font-normal text-muted-foreground">/{cameras.length}</span>
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('camerasActive', { count: active })}</p>
        </div>
        <span
          className={[
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
            recentCamera ? 'bg-state-heat/15 text-state-heat-fg' : 'bg-state-live/15 text-state-live-fg',
          ].join(' ')}
        >
          <span
            className={[
              'size-1.5 rounded-full',
              recentCamera ? 'animate-pulse bg-state-heat' : 'bg-state-live',
            ].join(' ')}
          />
          {recentCamera ? t('recentAlert', { name: recentCamera.name }) : t('camerasQuiet')}
        </span>
      </div>

      <ul className="mt-auto flex flex-col gap-2.5">
        {cameras.map((camera) => {
          const recent =
            !!camera.lastEventAt && Date.now() - new Date(camera.lastEventAt).getTime() < RECENT_MS;
          const eventLabel = camera.lastEventType
            ? t((EVENT_KEY[camera.lastEventType] ?? 'eventMotion') as Parameters<typeof t>[0])
            : null;

          return (
            <li key={camera.id}>
              <Link
                href={`/dashboard/cameras?camera=${camera.id}` as Route}
                className="group flex items-center gap-3.5 rounded-2xl border border-border/60 bg-foreground/[0.03] px-3.5 py-3 transition-all duration-300 hover:border-border hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground">
                  <Camera className="size-[1.1rem]" />
                  {/* Punto de estado: verde activa, gris desactivada. */}
                  <span
                    className={[
                      'absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-card',
                      camera.enabled ? 'bg-state-live' : 'bg-muted-foreground/50',
                    ].join(' ')}
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{camera.name}</span>
                  <span
                    className={[
                      'block truncate text-xs',
                      recent ? 'font-medium text-state-heat-fg' : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {!camera.enabled
                      ? t('cameraDisabled')
                      : camera.lastEventAt && eventLabel
                        ? `${eventLabel} · ${relativeTime(camera.lastEventAt, locale)}`
                        : t('noEvents')}
                  </span>
                </span>

                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Tile>
  );
}
