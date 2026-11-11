import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import type { CameraOverview } from '@/lib/home-pulse-types';
import { Section } from './section';

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

  return (
    <Section
      title={t('cameras')}
      meta={`${active}/${cameras.length}`}
      href="/dashboard/cameras"
      hrefLabel={t('seeAll')}
      className={className}
    >
      <ul className="surface divide-y divide-border/70 overflow-hidden rounded-3xl">
        {cameras.map((camera) => {
          const recent =
            camera.enabled &&
            !!camera.lastEventAt &&
            Date.now() - new Date(camera.lastEventAt).getTime() < RECENT_MS;
          const eventLabel = camera.lastEventType
            ? t((EVENT_KEY[camera.lastEventType] ?? 'eventMotion') as Parameters<typeof t>[0])
            : null;

          return (
            <li key={camera.id}>
              <Link
                href={`/dashboard/cameras?camera=${camera.id}` as Route}
                className="group flex min-h-[3.75rem] items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {/* Punto de estado: verde activa, violeta con aviso reciente, gris
                    desactivada. El ámbar se reserva para la calefacción. */}
                <span
                  className={[
                    'size-2.5 shrink-0 rounded-full',
                    !camera.enabled ? 'bg-muted-foreground/40' : recent ? 'bg-primary' : 'bg-state-live',
                  ].join(' ')}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium leading-snug">{camera.name}</span>
                  <span
                    className={[
                      'block truncate text-sm leading-snug',
                      recent ? 'font-medium text-foreground' : 'text-muted-foreground',
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
    </Section>
  );
}
