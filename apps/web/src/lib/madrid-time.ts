/**
 * Calendario de casa (Europe/Madrid) para un servidor que corre en UTC.
 *
 * Los días se manejan como 'YYYY-MM-DD'. Un día de Madrid no siempre dura 24 h:
 * el último domingo de marzo tiene 23 y el de octubre 25, así que los límites se
 * calculan con el desfase real de cada medianoche y no sumando horas.
 */

export const HOME_TIME_ZONE = 'Europe/Madrid';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: HOME_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function madridParts(instant: Date) {
  const out: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function isDayString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** Día de Madrid de un instante. */
export function madridDate(instant = new Date()): string {
  const p = madridParts(instant);
  return iso(p.year, p.month, p.day);
}

/** Hora (0-23) de Madrid de un instante. */
export function madridHour(instant = new Date()): number {
  return madridParts(instant).hour;
}

/** Suma días de calendario a un 'YYYY-MM-DD'. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Instante UTC de la medianoche de Madrid que abre un día. */
function madridMidnight(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const utcMidnight = Date.UTC(y!, m! - 1, d!);
  // Desfase de Madrid en la medianoche UTC del mismo día. Los cambios de hora
  // son a la 01:00 UTC, después de las dos medianoches, así que es el mismo
  // desfase que rige en la medianoche de Madrid.
  const p = madridParts(new Date(utcMidnight));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMidnight;
  return new Date(utcMidnight - offset);
}

/** [inicio, fin) de un día de Madrid en instantes UTC. */
export function madridDayBounds(day: string): { start: Date; end: Date } {
  return { start: madridMidnight(day), end: madridMidnight(addDays(day, 1)) };
}
