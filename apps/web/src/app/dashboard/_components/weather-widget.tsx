import Link from 'next/link';
import { MapPin, Droplets, Wind, Umbrella, Sun, TriangleAlert } from 'lucide-react';
import { getTranslations, getLocale } from 'next-intl/server';

import type { WeatherData, DailyForecast, HourlyPoint } from '@/lib/weather';
import { wmoToEmoji, wmoToFamily, wmoToKey } from '@/lib/weather';
import { WeatherDayChart } from './weather-day-chart';

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatHour(isoTime: string): string {
  // "2025-06-01T14:00" → "14:00"
  return isoTime.slice(11, 16);
}

function formatDayLabel(
  dateStr: string,
  locale: string,
  todayStr: string,
  tomorrowStr: string,
): string {
  if (dateStr === todayStr) return tomorrowStr; // reuse "tomorrow" label check below
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
}

function getDayLabel(
  dateStr: string,
  locale: string,
  todayISO: string,
  tomorrowISO: string,
  todayLabel: string,
  tomorrowLabel: string,
): string {
  if (dateStr === todayISO) return todayLabel;
  if (dateStr === tomorrowISO) return tomorrowLabel;
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
}

function formatAlertDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl bg-foreground/[0.045] px-3 py-2 text-center min-w-[72px]">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

/**
 * Tira de próximas horas.
 *
 * Antes era una fila de tarjetas idénticas, cada una con su caja, su icono y
 * su hora. Con quince horas de sol seguidas el resultado era quince cajas
 * iguales: mucho ruido para muy poca información. Ahora se quitan las cajas y
 * **el icono sólo aparece cuando el tiempo cambia** respecto a la hora
 * anterior, así que deja de ser papel pintado y pasa a marcar justo lo que
 * interesa: dónde se nubla, dónde empieza a llover. La temperatura gana peso
 * porque es el dato que de verdad se consulta.
 */
function HourlyStrip({
  points,
  nowLabel,
  currentTime,
}: {
  points: HourlyPoint[];
  nowLabel: string;
  currentTime: string;
}) {
  const currentHourKey = currentTime.slice(0, 13);

  return (
    <div className="styled-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-2">
      {points.map((point, i) => {
        const isNow = point.time.slice(0, 13) === currentHourKey;
        // El icono sólo si el tiempo cambia (o en el primer hueco, para dar
        // referencia de partida). Se compara la FAMILIA de condición, no el
        // código: la previsión oscila sin parar entre despejado y mayormente
        // despejado, que son iconos distintos pero el mismo tiempo, y marcar
        // eso como cambio devuelve el ruido que queríamos quitar.
        const icon = wmoToEmoji(point.weatherCode);
        const changed =
          i === 0 || wmoToFamily(point.weatherCode) !== wmoToFamily(points[i - 1]!.weatherCode);

        return (
          <div
            key={point.time}
            className={[
              'flex min-w-[62px] shrink-0 flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 transition-colors',
              isNow ? 'bg-primary/10 ring-1 ring-primary/25' : '',
            ].join(' ')}
          >
            <span
              className={[
                'text-xs font-medium',
                isNow ? 'text-foreground' : 'text-muted-foreground',
              ].join(' ')}
            >
              {isNow ? nowLabel : formatHour(point.time)}
            </span>

            {/* Altura reservada aunque no haya icono, para que las
                temperaturas queden alineadas en una sola línea. */}
            <span className="flex h-6 items-center text-xl leading-none">
              {changed ? icon : ''}
            </span>

            <span className="tnum text-base font-semibold">{point.temperature}°</span>

            <span className="tnum flex h-4 items-center text-xs text-state-cool">
              {point.precipitationProbability > 0 ? `${point.precipitationProbability}%` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DayCard({
  day,
  label,
}: {
  day: DailyForecast;
  label: string;
}) {
  const rainColor =
    day.precipitationProbability >= 70
      ? 'text-state-cool'
      : day.precipitationProbability >= 40
        ? 'text-state-cool/70'
        : 'text-muted-foreground';

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl bg-foreground/[0.045] px-3 py-3 min-w-[80px] flex-1">
      <span className="text-[11px] text-muted-foreground font-medium truncate w-full text-center">
        {label}
      </span>
      <span className="text-2xl leading-none">{wmoToEmoji(day.weatherCode)}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-semibold">{day.tempMax}°</span>
        <span className="text-xs text-muted-foreground">{day.tempMin}°</span>
      </div>
      <div className={`flex items-center gap-0.5 text-[10px] ${rainColor}`}>
        <Umbrella className="size-2.5" />
        <span>{day.precipitationProbability}%</span>
      </div>
      {day.uvIndex >= 6 && (
        <div className="flex items-center gap-0.5 text-[10px] text-state-light-fg">
          <Sun className="size-2.5" />
          <span>UV {day.uvIndex}</span>
        </div>
      )}
    </div>
  );
}

// ─── No-location placeholder ───────────────────────────────────────────────

async function NoLocationCard() {
  const t = await getTranslations('weather');
  return (
    <div className="glass flex flex-col items-center justify-center gap-4 rounded-2xl p-10 text-center animate-fade-in">
      <span className="text-5xl">🌍</span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('noLocation')}</h2>
        <p className="text-sm text-muted-foreground max-w-xs">{t('noLocationDesc')}</p>
      </div>
      <Link
        href="/dashboard/settings"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        {t('goToSettings')}
      </Link>
    </div>
  );
}

// ─── No-data placeholder ──────────────────────────────────────────────────

async function NoDataCard() {
  const t = await getTranslations('weather');
  return (
    <div className="glass flex flex-col items-center justify-center gap-3 rounded-2xl p-10 text-center animate-fade-in">
      <span className="text-5xl">🌧️</span>
      <p className="text-sm text-muted-foreground">{t('noData')}</p>
    </div>
  );
}

// ─── Main widget ───────────────────────────────────────────────────────────

interface WeatherWidgetProps {
  weather: WeatherData | null;
  hasAddress: boolean;
  /**
   * Muestra la tarjeta grande de condiciones actuales. La portada la oculta
   * porque su pieza del tiempo ya resume eso arriba; repetirlo sería ruido.
   */
  showCurrent?: boolean;
}

export async function WeatherWidget({ weather, hasAddress, showCurrent = true }: WeatherWidgetProps) {
  if (!hasAddress) return <NoLocationCard />;
  if (!weather) return <NoDataCard />;

  const t = await getTranslations('weather');
  const locale = await getLocale();

  const { current, hourly, todayHourly, currentTime, daily, alerts, locationName } = weather;

  // Compute today / tomorrow ISO strings for labels
  const nowDate = new Date();
  const todayISO = nowDate.toISOString().slice(0, 10);
  const tomorrowDate = new Date(nowDate);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowISO = tomorrowDate.toISOString().slice(0, 10);

  const conditionKey = wmoToKey(current.weatherCode);
  const conditionLabel = t(`conditions.${conditionKey}` as Parameters<typeof t>[0]);
  const mainEmoji = wmoToEmoji(current.weatherCode, current.isDay);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Alerts ─────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={`${alert.type}-${alert.date}`}
              className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
            >
              <TriangleAlert className="size-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-300">
                  {t('alerts.title')}
                </p>
                <p className="text-xs text-amber-400/80">
                  {t(`alerts.${alert.type}` as Parameters<typeof t>[0], {
                    date: formatAlertDate(alert.date, locale),
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Current conditions card ────────────────────────────────── */}
      {showCurrent && (
      <div className="glass rounded-2xl p-6">
        {/* Location */}
        <div className="mb-5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          <span className="truncate">{locationName}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-6">
          {/* Temp + condition */}
          <div className="flex items-center gap-4">
            <span className="text-7xl leading-none select-none" role="img" aria-label={conditionLabel}>
              {mainEmoji}
            </span>
            <div>
              <p className="text-6xl font-bold tracking-tight leading-none">
                {current.temperature}°
              </p>
              <p className="mt-1 text-base text-muted-foreground">{conditionLabel}</p>
              <p className="text-sm text-muted-foreground">
                {t('feelsLike')}: {current.feelsLike}°
              </p>
            </div>
          </div>

          {/* Stats pills */}
          <div className="flex flex-wrap gap-2">
            <StatPill
              icon={<Droplets className="size-3.5" />}
              value={`${current.humidity}%`}
              label={t('humidity')}
            />
            <StatPill
              icon={<Wind className="size-3.5" />}
              value={`${current.windSpeed} km/h`}
              label={t('wind')}
            />
            <StatPill
              icon={<Umbrella className="size-3.5" />}
              value={`${current.precipitation} mm`}
              label={t('precipitation')}
            />
            {daily[0] && (
              <StatPill
                icon={<Sun className="size-3.5" />}
                value={`${daily[0].uvIndex}`}
                label={t('uvIndex')}
              />
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── Hourly forecast ────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-5">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('hourlyForecast')}
        </h3>
        <HourlyStrip points={hourly} currentTime={currentTime} nowLabel={t('now')} />
      </div>

      {/* ── Today's temperature + rain chart ───────────────────────── */}
      {todayHourly.length >= 2 && (
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dayChart')}
          </h3>
          <WeatherDayChart
            points={todayHourly}
            currentTime={currentTime}
            labels={{
              title: t('dayChart'),
              now: t('now'),
              chanceOfRain: t('chanceOfRain'),
            }}
          />
        </div>
      )}

      {/* ── 10-day forecast ────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-5">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('tenDayForecast')}
        </h3>
        <div className="flex gap-2 overflow-x-auto pb-2 styled-scrollbar">
          {daily.map((day) => (
            <DayCard
              key={day.date}
              day={day}
              label={getDayLabel(
                day.date,
                locale,
                todayISO,
                tomorrowISO,
                t('today'),
                t('tomorrow'),
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
