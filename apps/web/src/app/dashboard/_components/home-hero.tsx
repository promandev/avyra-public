import { getLocale, getTranslations } from 'next-intl/server';

import type { HouseOverview } from '@/lib/home-pulse-types';
import { Greeting } from './greeting';

interface HomeHeroProps {
  name: string;
  overview: HouseOverview;
  className?: string;
}

type Translator = Awaited<ReturnType<typeof getTranslations<'dashboard.summary'>>>;

/** Subsistema del que habla cada fragmento; decide su color. */
type Tone = 'heat' | 'cool' | 'light' | 'live' | 'quiet';

/* Clases literales: Tailwind tiene que poder verlas enteras. */
const TONE: Record<Tone, string> = {
  heat: 'text-state-heat-fg',
  cool: 'text-state-cool-fg',
  light: 'text-state-light-fg',
  live: 'text-state-live-fg',
  quiet: '',
};

/**
 * La casa contada en una frase.
 *
 * Los números de las piezas de abajo son exactos pero hay que leerlos uno a
 * uno. Esto los junta en lo que diría una persona al entrar: qué está en
 * marcha y dónde. Sólo menciona lo que está pasando; si no pasa nada, lo dice.
 * Se arma con fragmentos traducidos, y los nombres de los aparatos se unen
 * con el formateador de listas del idioma ("Salón y Cocina", "Salon et
 * Cuisine").
 */
function buildSummary(overview: HouseOverview, t: Translator, locale: string): { text: string; tone: Tone }[] {
  const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
  const parts: { text: string; tone: Tone }[] = [];

  const heating = overview.climate.filter((c) => c.kind === 'heat' && c.running).map((c) => c.name);
  const cooling = overview.climate.filter((c) => c.kind === 'cool' && c.running).map((c) => c.name);
  const lightsOn = overview.lights.filter((l) => l.on).length;
  const cleaning = overview.vacuums.filter((v) => v.state === 'cleaning').map((v) => v.name);

  if (heating.length > 0) parts.push({ text: t('heating', { names: list.format(heating) }), tone: 'heat' });
  if (cooling.length > 0) parts.push({ text: t('cooling', { names: list.format(cooling) }), tone: 'cool' });
  if (lightsOn > 0) parts.push({ text: t('lights', { count: lightsOn }), tone: 'light' });
  if (cleaning.length > 0) parts.push({ text: t('cleaning', { names: list.format(cleaning) }), tone: 'live' });

  if (parts.length === 0) parts.push({ text: t('quiet'), tone: 'quiet' });
  return parts;
}

/**
 * Cabecera de la portada: la frase de la casa como titular y, a su lado, la
 * temperatura interior. Va suelta sobre el fondo, sin tarjeta: es lo primero
 * que se lee y no necesita marco. Cada fragmento lleva el color de su
 * subsistema, el mismo que tiñe las piezas de abajo y el halo del fondo.
 */
export async function HomeHero({ name, overview, className = '' }: HomeHeroProps) {
  const t = await getTranslations('dashboard');
  const ts = await getTranslations('dashboard.summary');
  const locale = await getLocale();

  const summary = buildSummary(overview, ts, locale);
  const indoor =
    overview.indoorTemperature === null
      ? null
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(overview.indoorTemperature);

  return (
    // Dos columnas: el texto y la cifra. En móvil la cifra sube a la línea del
    // saludo y el titular ocupa todo el ancho, para no robarle sitio a lo que
    // se toca; desde `sm` la cifra queda a la derecha del titular.
    <header className={`grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 gap-y-2 sm:gap-x-12 ${className}`}>
      <div className="col-start-1 row-start-1 min-w-0">
        <Greeting name={name} />
      </div>
      <h1 className="col-span-2 row-start-2 max-w-3xl text-balance text-display-sm font-semibold sm:col-span-1">
        {summary.map((part, i) => (
          <span key={i} className={TONE[part.tone]}>
            {part.text}{' '}
          </span>
        ))}
      </h1>

      {/* Temperatura interior: la cifra que resume la casa. En sans, no en
          mono: la mono tabular separa demasiado la coma decimal. */}
      {indoor !== null && (
        <div className="col-start-2 row-start-1 flex items-baseline gap-2 text-right sm:row-span-2 sm:block sm:self-end">
          <p className="tnum order-2 text-2xl font-semibold leading-none tracking-[-0.04em] sm:text-6xl md:text-7xl">
            {indoor}°
          </p>
          <p className="text-sm text-muted-foreground sm:mt-2">{t('indoorTemperature')}</p>
        </div>
      )}
    </header>
  );
}
