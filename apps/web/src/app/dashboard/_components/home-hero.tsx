import { getLocale, getTranslations } from 'next-intl/server';
import { Thermometer } from 'lucide-react';

import { AvyraLogoMark } from '@/components/avyra-logo';
import type { HouseOverview } from '@/lib/home-pulse-types';
import { Greeting } from './greeting';

interface HomeHeroProps {
  name: string;
  householdName: string | null;
  overview: HouseOverview;
  className?: string;
}

type Translator = Awaited<ReturnType<typeof getTranslations<'dashboard.summary'>>>;

/**
 * La casa contada en una frase.
 *
 * Los números de las piezas de abajo son exactos pero hay que leerlos uno a
 * uno. Esto los junta en lo que diría una persona al entrar: qué está en
 * marcha y dónde. Sólo menciona lo que está pasando; si no pasa nada, lo dice.
 * Se arma con fragmentos traducidos, y los nombres de las estancias se unen
 * con el formateador de listas del idioma ("Salón y Cocina", "Salon et
 * Cuisine").
 */
function buildSummary(overview: HouseOverview, t: Translator, locale: string): string[] {
  const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
  const parts: string[] = [];

  const heating = overview.climate.filter((c) => c.kind === 'heat' && c.running).map((c) => c.name);
  const cooling = overview.climate.filter((c) => c.kind === 'cool' && c.running).map((c) => c.name);
  const lightsOn = overview.lights.filter((l) => l.on).length;
  const cleaning = overview.vacuums.filter((v) => v.state === 'cleaning').map((v) => v.name);

  if (heating.length > 0) parts.push(t('heating', { names: list.format(heating) }));
  if (cooling.length > 0) parts.push(t('cooling', { names: list.format(cooling) }));
  if (lightsOn > 0) parts.push(t('lights', { count: lightsOn }));
  if (cleaning.length > 0) parts.push(t('cleaning', { names: list.format(cleaning) }));

  if (parts.length === 0) parts.push(t('quiet'));
  return parts;
}

/**
 * Pieza protagonista de la portada: quién eres, qué casa estás mirando, qué
 * está pasando en ella y a cuánto está por dentro.
 */
export async function HomeHero({ name, householdName, overview, className = '' }: HomeHeroProps) {
  const t = await getTranslations('dashboard');
  const ts = await getTranslations('dashboard.summary');
  const locale = await getLocale();

  const summary = buildSummary(overview, ts, locale);
  const anyRunning =
    overview.lights.some((l) => l.on) ||
    overview.climate.some((c) => c.running) ||
    overview.vacuums.some((v) => v.state === 'cleaning');
  const indoor =
    overview.indoorTemperature === null
      ? null
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(overview.indoorTemperature);

  return (
    <section className={`surface-hero animate-scale-in relative overflow-hidden p-7 md:p-9 ${className}`}>
      {/* Marca de agua: la A de Avyra, apenas insinuada. */}
      <AvyraLogoMark
        size={340}
        className="pointer-events-none absolute -right-16 -top-24 hidden text-primary/[0.07] md:block dark:text-primary/[0.13]"
      />

      <div className="relative flex h-full flex-col justify-between gap-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 space-y-3">
            <Greeting name={name} />
            <h1 className="text-gradient text-display font-semibold">{householdName ?? t('yourHome')}</h1>
          </div>

          {/* Temperatura interior: la cifra que resume la casa. `ml-auto` la
              mantiene a la derecha también cuando baja de línea. */}
          {indoor !== null && (
            <div className="ml-auto shrink-0 text-right">
              <div className="mb-1.5 flex items-center justify-end gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                <Thermometer className="size-3.5" />
                <span>{t('indoorTemperature')}</span>
              </div>
              {/* En sans, no en mono: la mono tabular separa demasiado la coma
                  decimal y "20,6" acaba leyéndose como tres bloques sueltos. */}
              <p className="tnum text-5xl font-semibold leading-none tracking-tight md:text-6xl">
                {indoor}
                <span className="text-primary">°</span>
              </p>
            </div>
          )}
        </div>

        {/* La frase: cada fragmento entra con un pequeño retardo, como si la
            casa lo fuese contando. */}
        <p className="stagger max-w-2xl text-lg leading-relaxed text-foreground/85 md:text-xl">
          <span
            className={[
              'mr-3 inline-block size-2 translate-y-[-3px] rounded-full align-middle',
              anyRunning ? 'animate-pulse-ring bg-primary text-primary/40' : 'bg-muted-foreground/40',
            ].join(' ')}
            aria-hidden="true"
          />
          {summary.map((part, i) => (
            <span key={i} className="inline">
              {part}{' '}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
