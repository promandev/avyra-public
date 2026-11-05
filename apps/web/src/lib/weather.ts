import 'server-only';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WeatherData {
  locationName: string;
  current: {
    temperature: number;
    feelsLike: number;
    humidity: number;
    windSpeed: number;
    weatherCode: number;
    isDay: boolean;
    precipitation: number;
  };
  /** Next 24 hours, starting from current hour */
  hourly: HourlyPoint[];
  /** Every hour (00:00–23:00) of the current local day — used for the day chart */
  todayHourly: HourlyPoint[];
  /** Local ISO timestamp of the current observation, e.g. "2026-05-31T14:30" */
  currentTime: string;
  /** 10-day daily forecast */
  daily: DailyForecast[];
  /** Derived severe-weather alerts for the next 3 days */
  alerts: WeatherAlert[];
}

export interface HourlyPoint {
  /** ISO timestamp e.g. "2025-06-01T14:00" */
  time: string;
  temperature: number;
  weatherCode: number;
  precipitationProbability: number;
}

export interface DailyForecast {
  /** ISO date e.g. "2025-06-01" */
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipitationSum: number;
  precipitationProbability: number;
  uvIndex: number;
}

export interface WeatherAlert {
  type: 'thunderstorm' | 'heavy_rain' | 'snow';
  date: string;
}

// ─── WMO code helpers ──────────────────────────────────────────────────────

/**
 * Maps a WMO weather interpretation code to an i18n key under
 * `weather.conditions.*`.
 */
export function wmoToKey(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainlyClear';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'overcast';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57) return 'freezingDrizzle';
  if (code >= 61 && code <= 65) return 'rain';
  if (code === 66 || code === 67) return 'freezingRain';
  if (code >= 71 && code <= 77) return 'snowFall';
  if (code >= 80 && code <= 82) return 'rainShowers';
  if (code === 85 || code === 86) return 'snowShowers';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}

/**
 * Agrupa el código WMO en familias gruesas de condición.
 *
 * Sirve para decidir si el tiempo "ha cambiado" de una hora a la siguiente. La
 * previsión oscila constantemente entre despejado (0) y mayormente despejado
 * (1), que son iconos distintos pero el mismo tiempo a efectos prácticos.
 * Comparar familias evita marcar como cambio lo que sólo es ruido.
 */
export function wmoToFamily(code: number): string {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 85 || code === 86) return 'snow';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'freezing';
  if (code >= 95) return 'storm';
  return 'rain';
}

/**
 * Maps a WMO code to an emoji icon.
 * Pass `isDay = false` to get the night variant for clear sky.
 */
export function wmoToEmoji(code: number, isDay = true): string {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code === 1) return isDay ? '🌤️' : '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 55) return '🌦️';
  if (code === 56 || code === 57) return '🌨️';
  if (code >= 61 && code <= 65) return '🌧️';
  if (code === 66 || code === 67) return '🌨️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

// ─── Geocoding via Nominatim (OpenStreetMap) ──────────────────────────────

async function geocode(
  query: string,
): Promise<{ lat: number; lon: number; displayName: string } | null> {
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: query,
        format: 'json',
        limit: '1',
        addressdetails: '0',
      });

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Avyra/1.0 home-automation-app contact@avyra.app',
        'Accept-Language': 'es,en',
      },
      next: { revalidate: 86400 }, // Cache geocoding 24 h
    });

    if (!res.ok) return null;

    const data: Array<{ lat: string; lon: string; display_name: string }> =
      await res.json();
    if (!data.length || !data[0]) return null;

    const first = data[0];
    // Show first part + country from the display_name
    const parts = first.display_name.split(',').map((s) => s.trim());
    const displayName: string =
      parts.length >= 2
        ? `${parts[0]}, ${parts[parts.length - 1]}`
        : (parts[0] ?? query);

    return {
      lat: parseFloat(first.lat),
      lon: parseFloat(first.lon),
      displayName,
    };
  } catch {
    return null;
  }
}

// ─── Weather via Open-Meteo (free, no API key) ─────────────────────────────

/**
 * Fetches current conditions + 24-hour hourly + 10-day daily forecast.
 * Returns null if the location cannot be geocoded or the API is unreachable.
 */
export async function getWeatherForLocation(
  location: string,
): Promise<WeatherData | null> {
  try {
    const geo = await geocode(location);
    if (!geo) return null;

    const params = new URLSearchParams({
      latitude: geo.lat.toString(),
      longitude: geo.lon.toString(),
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'is_day',
        'precipitation',
        'weather_code',
        'wind_speed_10m',
      ].join(','),
      hourly: [
        'temperature_2m',
        'precipitation_probability',
        'weather_code',
      ].join(','),
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'precipitation_probability_max',
        'uv_index_max',
      ].join(','),
      timezone: 'auto',
      forecast_days: '10',
    });

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params}`,
      { next: { revalidate: 1800 } }, // Cache 30 min
    );
    if (!res.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await res.json();

    const allHourly: HourlyPoint[] = (raw.hourly.time as string[]).map(
      (t, i) => ({
        time: t,
        temperature: Math.round(raw.hourly.temperature_2m[i] as number),
        weatherCode: raw.hourly.weather_code[i] as number,
        precipitationProbability:
          (raw.hourly.precipitation_probability[i] as number) ?? 0,
      }),
    );

    // Times come back in the location's own timezone (timezone=auto), so we
    // anchor "today" / "now" to the API's current timestamp rather than the
    // server clock (which may sit in a different timezone).
    const currentTime = raw.current.time as string; // "2026-05-31T14:30"
    const todayDate = currentTime.slice(0, 10); // "2026-05-31"
    const currentHourKey = currentTime.slice(0, 13); // "2026-05-31T14"

    // Full current day, hour by hour, for the temperature/rain chart.
    const todayHourly = allHourly.filter(
      (p) => p.time.slice(0, 10) === todayDate,
    );

    // Next-24-hour strip, starting from the current hour.
    const startIdx = allHourly.findIndex(
      (p) => p.time.slice(0, 13) >= currentHourKey,
    );
    const hourly =
      startIdx >= 0
        ? allHourly.slice(startIdx, startIdx + 24)
        : allHourly.slice(0, 24);

    const daily: DailyForecast[] = (raw.daily.time as string[]).map(
      (date, i) => ({
        date,
        weatherCode: raw.daily.weather_code[i] as number,
        tempMax: Math.round(raw.daily.temperature_2m_max[i] as number),
        tempMin: Math.round(raw.daily.temperature_2m_min[i] as number),
        precipitationSum:
          Math.round(
            ((raw.daily.precipitation_sum[i] as number) ?? 0) * 10,
          ) / 10,
        precipitationProbability:
          (raw.daily.precipitation_probability_max[i] as number) ?? 0,
        uvIndex: Math.round((raw.daily.uv_index_max[i] as number) ?? 0),
      }),
    );

    // Derive alerts from weather codes in the next 3 days
    const alerts: WeatherAlert[] = daily.slice(0, 3).flatMap(
      (d): WeatherAlert[] => {
        const c = d.weatherCode;
        if (c >= 95) return [{ type: 'thunderstorm', date: d.date }];
        if ((c >= 71 && c <= 77) || c === 85 || c === 86)
          return [{ type: 'snow', date: d.date }];
        if (c === 63 || c === 65 || c === 67 || c === 82)
          return [{ type: 'heavy_rain', date: d.date }];
        return [];
      },
    );

    return {
      locationName: geo.displayName,
      current: {
        temperature: Math.round(raw.current.temperature_2m as number),
        feelsLike: Math.round(raw.current.apparent_temperature as number),
        humidity: raw.current.relative_humidity_2m as number,
        windSpeed: Math.round(raw.current.wind_speed_10m as number),
        weatherCode: raw.current.weather_code as number,
        isDay: (raw.current.is_day as number) === 1,
        precipitation: (raw.current.precipitation as number) ?? 0,
      },
      hourly,
      todayHourly,
      currentTime,
      daily,
      alerts,
    };
  } catch {
    return null;
  }
}
