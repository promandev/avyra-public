/**
 * Arenero: tipos y cálculos puros, compartidos por servidor y cliente.
 *
 * Aquí no hay base de datos ni Home Assistant. La reconstrucción de visitas a
 * partir del historial también vive aquí, para poder probarla a mano con node.
 */

export const LITTER_COMMANDS = ['clean', 'empty', 'reset'] as const;
export type LitterCommand = (typeof LITTER_COMMANDS)[number];

export const LITTER_VISIT_KINDS = ['pee', 'poop', 'unknown'] as const;
export type LitterVisitKind = (typeof LITTER_VISIT_KINDS)[number];

/**
 * Qué cuenta la entidad de duración: los segundos acumulados del día (lo que
 * dice el nombre del DP de Tuya, `excretion_time_day`) o sólo la última visita.
 */
export const LITTER_DURATION_MODES = ['daily_total', 'per_visit'] as const;
export type LitterDurationMode = (typeof LITTER_DURATION_MODES)[number];

/** Dominios que sirven para lanzar una acción del arenero. */
export const LITTER_ACTION_DOMAINS = ['button', 'switch', 'script'] as const;
/** Dominios de un interruptor que se enciende y se apaga. */
export const LITTER_TOGGLE_DOMAINS = ['switch', 'input_boolean'] as const;
/** Dominios de un valor numérico ajustable. */
export const LITTER_NUMBER_DOMAINS = ['number', 'input_number'] as const;

export interface LitterCatInfo {
  id: string;
  name: string;
  referenceWeightKg: number;
}

export interface LitterVisitRow {
  id: string;
  occurredAt: string;
  weightKg: number | null;
  durationS: number | null;
  catId: string | null;
  catManual: boolean;
  kind: LitterVisitKind;
  kindManual: boolean;
}

export interface LitterCatSummary {
  /** null = visitas que no se pudieron asignar a ningún gato. */
  catId: string | null;
  name: string | null;
  visits: number;
  pee: number;
  poop: number;
  unknown: number;
  /** Suma de las visitas con duración conocida. */
  totalSeconds: number;
  avgSeconds: number | null;
  lastWeightKg: number | null;
}

export interface LitterDayData {
  date: string;
  visits: LitterVisitRow[];
  summary: LitterCatSummary[];
}

/** Un `number` de HA con sus límites, tal como lo anuncia la entidad. */
export interface LitterNumberSetting {
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface LitterLiveState {
  state: string | null;
  /** Fallos activos ahora mismo, con el nombre que les da HA. */
  faults: string[];
  offline: boolean;
  /** null = sin entidad configurada o sin lectura. */
  autoClean: boolean | null;
  cleanDelay: LitterNumberSetting | null;
}

/**
 * Entidad que dice si el arenero está conectado: la de estado si la hay. Hay
 * modelos (el MINI-D) sin sensor de estado; ahí vale cualquiera de sus
 * sensores, que la integración pone en `unavailable` cuando se desconecta.
 */
export function availabilityEntity(box: {
  haEntityId: string | null;
  visitsEntityId: string | null;
  weightEntityId: string | null;
}): string | null {
  return box.haEntityId ?? box.visitsEntityId ?? box.weightEntityId;
}

/** Lee un `number` de HA. null si no hay lectura o no es un número. */
export function readNumberSetting(
  state: string | undefined,
  attributes: Record<string, unknown> | undefined,
): LitterNumberSetting | null {
  const value = state === undefined || state.trim() === '' ? Number.NaN : Number(state);
  if (!Number.isFinite(value)) return null;
  const num = (key: string, fallback: number) => {
    const raw = attributes?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  };
  const step = num('step', 1);
  return { value, min: num('min', 0), max: num('max', 100), step: step > 0 ? step : 1 };
}

/** Ajusta un valor a los límites y al paso de un `number`. */
export function clampToSetting(value: number, setting: Omit<LitterNumberSetting, 'value'>): number {
  const stepped = Math.round((value - setting.min) / setting.step) * setting.step + setting.min;
  const clamped = Math.min(setting.max, Math.max(setting.min, stepped));
  // Sin arrastrar decimales de coma flotante (0.1 + 0.2…).
  return Number(clamped.toFixed(6));
}

export function isLitterVisitKind(value: unknown): value is LitterVisitKind {
  return typeof value === 'string' && (LITTER_VISIT_KINDS as readonly string[]).includes(value);
}

export function humanizeValue(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

// ---------- Gato y tipo ---------------------------------------------------------

/**
 * El gato cuyo peso de referencia está más cerca. La báscula no es exacta,
 * pero entre un gato de 8 kg y otro de 5 el más cercano acierta casi siempre.
 */
export function nearestCat(weightKg: number | null, cats: readonly LitterCatInfo[]): string | null {
  if (weightKg === null || cats.length === 0) return null;
  let best = cats[0]!;
  for (const cat of cats) {
    if (Math.abs(cat.referenceWeightKg - weightKg) < Math.abs(best.referenceWeightKg - weightKg)) {
      best = cat;
    }
  }
  return best.id;
}

/**
 * Estimación pis/caca por el tiempo dentro: hacer caca lleva más rato. Es una
 * estimación y se enseña como tal; cada visita se puede corregir a mano.
 */
export function classifyVisit(durationS: number | null, poopMinSeconds: number): LitterVisitKind {
  if (durationS === null) return 'unknown';
  return durationS >= poopMinSeconds ? 'poop' : 'pee';
}

/** Peso en kg según la unidad que publica la entidad. */
export function toKg(value: number, unit: unknown): number {
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  let kg: number;
  if (u === 'g') kg = value / 1000;
  else if (u === 'lb' || u === 'lbs') kg = value * 0.45359237;
  else if (u === 'kg') kg = value;
  // Sin unidad: ningún gato pesa 50 kg, así que un número así son gramos.
  else kg = value > 50 ? value / 1000 : value;
  return Math.round(kg * 100) / 100;
}

// ---------- Resumen del día -----------------------------------------------------

interface SummarizableVisit {
  occurredAt: string | Date;
  catId: string | null;
  kind: string;
  durationS: number | null;
  weightKg: number | null;
}

/**
 * Una fila por gato, en el orden de `cats` y también con los que no han ido,
 * porque saber que un gato no ha ido es justo lo que interesa. Las visitas sin
 * gato van al final, sólo si las hay.
 */
export function summarizeVisits(
  visits: readonly SummarizableVisit[],
  cats: readonly LitterCatInfo[],
): LitterCatSummary[] {
  const rows = new Map<string | null, LitterCatSummary & { timed: number; lastAt: number }>();
  const blank = (catId: string | null, name: string | null) => ({
    catId,
    name,
    visits: 0,
    pee: 0,
    poop: 0,
    unknown: 0,
    totalSeconds: 0,
    avgSeconds: null,
    lastWeightKg: null,
    timed: 0,
    lastAt: -Infinity,
  });
  for (const cat of cats) rows.set(cat.id, blank(cat.id, cat.name));

  for (const v of visits) {
    const key = v.catId !== null && rows.has(v.catId) ? v.catId : null;
    if (!rows.has(key)) rows.set(key, blank(null, null));
    const row = rows.get(key)!;
    row.visits += 1;
    if (v.kind === 'pee') row.pee += 1;
    else if (v.kind === 'poop') row.poop += 1;
    else row.unknown += 1;
    if (v.durationS !== null) {
      row.totalSeconds += v.durationS;
      row.timed += 1;
    }
    const at = new Date(v.occurredAt).getTime();
    if (v.weightKg !== null && at >= row.lastAt) {
      row.lastAt = at;
      row.lastWeightKg = v.weightKg;
    }
  }

  return [...rows.values()].map((row) => ({
    catId: row.catId,
    name: row.name,
    visits: row.visits,
    pee: row.pee,
    poop: row.poop,
    unknown: row.unknown,
    totalSeconds: row.totalSeconds,
    avgSeconds: row.timed > 0 ? Math.round(row.totalSeconds / row.timed) : null,
    lastWeightKg: row.lastWeightKg,
  }));
}

// ---------- Reconstrucción de visitas -------------------------------------------

export interface SeriesPoint {
  state: string;
  at: Date;
}

export interface ExtractedVisit {
  at: Date;
  /** En la unidad de la entidad; quien llama lo pasa a kg. */
  weight: number | null;
  durationS: number | null;
}

/**
 * Cuánto antes o después del contador puede publicar el arenero el peso y la
 * duración de la misma visita. Los DP de Tuya llegan sueltos y sin orden fijo.
 */
export const VISIT_MATCH_WINDOW_MS = 2 * 60_000;
/** Un salto mayor del contador es un error de lectura, no cinco gatos en 30 s. */
const MAX_VISITS_PER_STEP = 5;

interface Change {
  at: Date;
  value: number;
  /** Valor anterior; null en el primer punto, que es el estado de partida. */
  previous: number | null;
}

function numeric(state: string): number | null {
  if (state.trim() === '') return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cambios de valor numérico. `unavailable` y compañía se saltan: un corte de HA
 * que deja el contador en 3 → unavailable → 3 no es ninguna visita.
 */
function numericChanges(points: readonly SeriesPoint[]): Change[] {
  const out: Change[] = [];
  let previous: number | null = null;
  for (const p of points) {
    const value = numeric(p.state);
    if (value === null || value === previous) continue;
    out.push({ at: p.at, value, previous });
    previous = value;
  }
  return out;
}

/**
 * El cambio sin usar más cercano a `at` dentro de la ventana. Las puestas a
 * cero no cuentan: la de medianoche no es el dato de ninguna visita.
 */
function closestChange(changes: Change[], used: Set<Change>, at: number): Change | null {
  let best: Change | null = null;
  for (const c of changes) {
    if (c.previous === null || c.value <= 0 || used.has(c)) continue;
    const gap = Math.abs(c.at.getTime() - at);
    if (gap > VISIT_MATCH_WINDOW_MS) continue;
    if (!best || gap < Math.abs(best.at.getTime() - at)) best = c;
  }
  if (best) used.add(best);
  return best;
}

/** Último valor conocido hasta `at` (incluido el estado de partida). */
function valueAsOf(changes: Change[], at: number): number | null {
  let value: number | null = null;
  for (const c of changes) {
    if (c.at.getTime() > at) break;
    value = c.value;
  }
  return value;
}

/**
 * Visitas ocurridas en (after, until] a partir del historial de HA.
 *
 * Con contador, cada subida es una visita (y una bajada es la puesta a cero de
 * medianoche: lo que marque ya son visitas nuevas). Sin contador, cada cambio
 * de peso es una visita, aunque así se pierde la segunda de un gato que pesa
 * exactamente lo mismo dos veces seguidas.
 */
export function extractVisits(
  input: {
    counter?: readonly SeriesPoint[];
    weight?: readonly SeriesPoint[];
    duration?: readonly SeriesPoint[];
    durationMode: LitterDurationMode;
  },
  after: Date,
  until: Date,
): ExtractedVisit[] {
  const weights = numericChanges(input.weight ?? []);
  const durations = numericChanges(input.duration ?? []);
  const usedWeights = new Set<Change>();
  const usedDurations = new Set<Change>();

  // Momentos de visita, con el peso ya resuelto si la visita sale del peso.
  const moments: { at: Date; weight: number | null }[] = [];
  if (input.counter) {
    for (const c of numericChanges(input.counter)) {
      if (c.previous === null) continue;
      const steps = Math.min(
        MAX_VISITS_PER_STEP,
        Math.round(c.value > c.previous ? c.value - c.previous : c.value),
      );
      // Dos visitas en el mismo cambio se separan un milisegundo para que no
      // choquen en la clave única (dispositivo, momento).
      for (let i = 0; i < steps; i++) moments.push({ at: new Date(c.at.getTime() + i), weight: null });
    }
  } else {
    for (const c of weights) {
      if (c.previous === null || c.value <= 0) continue;
      usedWeights.add(c);
      moments.push({ at: c.at, weight: c.value });
    }
  }

  const out: ExtractedVisit[] = [];
  for (const moment of moments) {
    const at = moment.at.getTime();
    if (at <= after.getTime() || at > until.getTime()) continue;

    let weight = moment.weight;
    if (weight === null && input.weight) {
      // Si el gato pesa lo mismo que la vez anterior, HA no anota cambio: vale
      // el último peso conocido.
      weight = closestChange(weights, usedWeights, at)?.value ?? valueAsOf(weights, at + VISIT_MATCH_WINDOW_MS);
      if (weight !== null && weight <= 0) weight = null;
    }

    let durationS: number | null = null;
    if (input.duration) {
      const change = closestChange(durations, usedDurations, at);
      if (input.durationMode === 'daily_total') {
        if (change && change.previous !== null) {
          const delta = change.value - change.previous;
          // Una bajada es la puesta a cero del día seguida de esta visita.
          durationS = delta > 0 ? delta : change.value > 0 ? change.value : null;
        }
      } else {
        const value = change?.value ?? valueAsOf(durations, at + VISIT_MATCH_WINDOW_MS);
        durationS = value !== null && value > 0 ? value : null;
      }
      if (durationS !== null) durationS = Math.round(durationS);
    }

    out.push({ at: moment.at, weight, durationS });
  }
  return out;
}
