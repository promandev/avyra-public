/**
 * Home Assistant REST API helper.
 * All functions are safe to call when HA is not configured — they return null/empty or throw.
 */

import { env } from './env';

export type HaState = 'on' | 'off' | 'unavailable' | 'unknown';

export interface HaClimateState {
  /** Modo seleccionado: 'heat', 'cool', 'off'… Es si el aparato está encendido. */
  state: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  /**
   * Lo que el aparato está haciendo AHORA: 'heating', 'cooling', 'idle', 'off'…
   *
   * No es lo mismo que `state`. Un termostato en modo 'heat' que ya ha
   * alcanzado la consigna sigue encendido pero no está dando calor, y su
   * `hvac_action` es 'idle'. Muchos termostatos baratos no lo reportan, así
   * que puede venir nulo y hay que deducirlo comparando temperaturas.
   */
  hvacAction: string | null;
  /**
   * ISO: última vez que la integración escribió el estado, aunque no cambiara
   * nada. Con un aparato en la nube (Tuya) es la señal de que sigue llegando
   * algo: si la sesión de la integración muere, HA conserva el último estado
   * tal cual y sin esto parecería un dato de ahora.
   */
  reportedAt: string | null;
}

/**
 * La llamada a un servicio de HA ha fallado. HA responde 500 cuando es la
 * integración del aparato la que falla por dentro (nube caída, sesión
 * caducada…) y el motivo no viaja en la respuesta: sólo queda el código.
 */
export class HaServiceError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`HA service call failed: ${status} ${statusText}`);
    this.name = 'HaServiceError';
  }
}

function parseTemperatureLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstNumericAttribute(
  attrs: Record<string, unknown> | undefined,
  keys: string[],
): number | null {
  if (!attrs) return null;
  for (const key of keys) {
    const v = parseTemperatureLike(attrs[key]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Normalize a temperature value coming from HA.
 * Handles common Tuya raw-unit cases:
 *  - deci-degrees (e.g. 230 → 23.0°C, used for current_temperature on some BHT devices)
 *  - half-degree integers with step<=0.5 (e.g. 46 → 23.0°C)
 * Does NOT correct for cases where HA has already applied a wrong factor
 * (e.g. BHT-003 target=3.6 instead of 18) — that is handled via temperatureScale.
 */
function normalizeHaTemperature(
  raw: number | null,
  attrs: Record<string, unknown> | undefined,
): number | null {
  if (raw === null) return null;
  let value = raw;

  // Fahrenheit conversion
  const unit = typeof attrs?.temperature_unit === 'string' ? attrs.temperature_unit : null;
  if (unit === '°F' || unit === 'F') {
    value = (value - 32) * (5 / 9);
  }

  // Deci-degrees (e.g. 230 → 23.0). Threshold >80 excludes normal temp values.
  if (value > 80 && value < 1000) {
    value = value / 10;
  }

  // Half-degree integers when step attribute signals 0.5°C resolution (e.g. 46 → 23.0).
  const step = parseTemperatureLike(attrs?.target_temp_step) ?? 1;
  if (step <= 0.5 && value > 35 && value <= 80) {
    value = value / 2;
  }

  return Number(value.toFixed(1));
}

const STATE_READ_TIMEOUT_MS = 10_000;
const STATE_FAIL_LOG_EVERY_MS = 60_000;
const lastStateFailLog = new Map<string, number>();

/**
 * Deja rastro cuando falla la lectura de una entidad (antes se tragaba en
 * silencio y no había forma de saber por qué la app mostraba un dispositivo
 * sin datos). Un aviso por entidad y minuto como máximo para no inundar el log.
 */
function logStateReadFailure(entityId: string, reason: string): void {
  const now = Date.now();
  if (now - (lastStateFailLog.get(entityId) ?? 0) < STATE_FAIL_LOG_EVERY_MS) return;
  lastStateFailLog.set(entityId, now);
  console.warn(`[ha] lectura de ${entityId} fallida: ${reason}`);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name === 'TimeoutError' ? `timeout ${STATE_READ_TIMEOUT_MS / 1000}s` : err.message;
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return cause ? `${name} (${cause})` : name;
  }
  return String(err);
}

/** Fetch the state of a single HA entity. Returns null when HA is not configured or the request fails. */
export async function getEntityState(entityId: string): Promise<HaState | null> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) return null;
  try {
    const res = await fetch(`${env.HA_BASE_URL}/api/states/${entityId}`, {
      headers: { Authorization: `Bearer ${env.HA_TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(STATE_READ_TIMEOUT_MS),
    });
    if (!res.ok) {
      logStateReadFailure(entityId, `HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { state: string };
    const s = data.state;
    if (s === 'on' || s === 'off' || s === 'unavailable' || s === 'unknown') return s;
    return null;
  } catch (err) {
    logStateReadFailure(entityId, describeError(err));
    return null;
  }
}

interface HaRawEntityState {
  state: string;
  attributes?: Record<string, unknown>;
  /** ISO: desde cuándo tiene este estado. */
  last_changed?: string;
  /** ISO: último cambio de estado o de atributos. */
  last_updated?: string;
  /** ISO: última escritura, cambiara algo o no (HA 2024.3+). */
  last_reported?: string;
}

/** Fetch raw state + attributes for one entity. Returns null if HA is unreachable or entity not found. */
export async function getRawEntityState(entityId: string): Promise<HaRawEntityState | null> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) return null;
  try {
    const base = env.HA_BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${base}/api/states/${entityId}`, {
      headers: { Authorization: `Bearer ${env.HA_TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(STATE_READ_TIMEOUT_MS),
    });
    if (!res.ok) {
      logStateReadFailure(entityId, `HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as HaRawEntityState;
  } catch (err) {
    logStateReadFailure(entityId, describeError(err));
    return null;
  }
}

export interface HaHistoryPoint {
  state: string;
  at: Date;
}

/**
 * Cambios de estado de varias entidades entre `start` y `end`, en orden. El
 * primer punto de cada entidad es el estado que tenía al empezar el tramo, no un
 * cambio. Una entidad sin estado en el tramo no aparece.
 *
 * Devuelve null si HA no responde, para que quien llama no lo confunda con
 * "no ha pasado nada".
 */
export async function getHaHistory(
  entityIds: string[],
  start: Date,
  end: Date,
): Promise<Record<string, HaHistoryPoint[]> | null> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN || entityIds.length === 0) return null;
  try {
    const base = env.HA_BASE_URL.replace(/\/$/, '');
    const params = new URLSearchParams({
      filter_entity_id: entityIds.join(','),
      end_time: end.toISOString(),
      // Todos los cambios de estado, también los de sensores que HA no
      // considera "significativos".
      significant_changes_only: '0',
    });
    const res = await fetch(
      `${base}/api/history/period/${encodeURIComponent(start.toISOString())}?${params}&minimal_response`,
      {
        headers: { Authorization: `Bearer ${env.HA_TOKEN}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { entity_id?: string; state: string; last_changed: string }[][];

    const out: Record<string, HaHistoryPoint[]> = {};
    for (const series of data) {
      // Con minimal_response sólo el primer punto lleva entity_id.
      const entityId = series[0]?.entity_id;
      if (!entityId) continue;
      out[entityId] = series.map((p) => ({ state: p.state, at: new Date(p.last_changed) }));
    }
    return out;
  } catch {
    return null;
  }
}

/** Batch-fetch states for multiple entity IDs. Missing / failed entities are omitted from the result. */
export async function getEntityStates(
  entityIds: string[],
): Promise<Record<string, HaState>> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN || entityIds.length === 0) return {};
  const results = await Promise.allSettled(
    entityIds.map((id) => getEntityState(id).then((s) => [id, s] as const)),
  );
  const out: Record<string, HaState> = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value[1] !== null) {
      out[r.value[0]] = r.value[1];
    }
  }
  return out;
}

/** Batch-fetch climate-friendly state for multiple climate entities. */
export async function getClimateEntityStates(
  entityIds: string[],
): Promise<Record<string, HaClimateState>> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN || entityIds.length === 0) return {};
  const results = await Promise.allSettled(
    entityIds.map(async (id) => {
      const raw = await getRawEntityState(id);
      if (!raw) return [id, null] as const;

      const current = firstNumericAttribute(raw.attributes, [
        'current_temperature',
        'local_temperature',
        'current_temp',
        'temperature_current',
      ]);
      const target = firstNumericAttribute(raw.attributes, [
        'temperature',
        'target_temperature',
        'target_temp',
        'set_temperature',
        'set_temp',
        'heating_setpoint',
        'current_heating_setpoint',
      ]);
      const action = raw.attributes?.hvac_action;

      const parsed: HaClimateState = {
        state: raw.state,
        currentTemperature: normalizeHaTemperature(current, raw.attributes),
        targetTemperature: normalizeHaTemperature(target, raw.attributes),
        hvacAction: typeof action === 'string' ? action : null,
        reportedAt: raw.last_reported ?? raw.last_updated ?? null,
      };
      return [id, parsed] as const;
    }),
  );

  const out: Record<string, HaClimateState> = {};
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value[1] !== null) {
      out[result.value[0]] = result.value[1];
    }
  }
  return out;
}

/**
 * Call a HA service (e.g. homeassistant/toggle, light/turn_on, switch/turn_off).
 * Throws if HA is not configured or the request fails.
 */
export async function callHaService(
  domain: string,
  service: string,
  entityId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) {
    throw new Error('Home Assistant is not configured (HA_BASE_URL / HA_TOKEN missing)');
  }
  const base = env.HA_BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/api/services/${domain}/${service}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.HA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entity_id: entityId, ...(data ?? {}) }),
  });
  if (!res.ok) {
    throw new HaServiceError(res.status, res.statusText);
  }
}

// ---------------------------------------------------------------------------
// HA Automation CRUD (used by thermostat schedules)
// ---------------------------------------------------------------------------

export interface HaAutomationConfig {
  alias: string;
  description?: string;
  mode?: string;
  /** Use HA 2024.4+ singular-array keys: trigger / condition / action */
  trigger: unknown[];
  condition?: unknown[];
  action: unknown[];
}

/**
 * Create (or replace) a HA automation via the config REST API.
 * Uses the caller-supplied `automationId` as the HA automation ID so we can
 * reliably delete it later.  Returns true on success.
 *
 * Sends to  POST /api/config/automation/config/{id}  (creates or overwrites).
 * HA config automation API requires the `id` both in the URL and in the body.
 * After creation the automations are reloaded so the schedule is active immediately.
 */
export async function createHaAutomation(
  automationId: string,
  config: HaAutomationConfig,
): Promise<boolean> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) return false;
  const base = env.HA_BASE_URL.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/config/automation/config/${automationId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.HA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: automationId, ...config }),
    });
    if (!res.ok) return false;
    // Reload so the new automation is active immediately.
    await reloadHaAutomations(base);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a HA automation by ID. Silently ignores errors (e.g. already deleted).
 */
export async function deleteHaAutomation(automationId: string): Promise<void> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) return;
  const base = env.HA_BASE_URL.replace(/\/$/, '');
  try {
    await fetch(`${base}/api/config/automation/config/${automationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.HA_TOKEN}` },
    });
    await reloadHaAutomations(base);
  } catch {
    // Ignore
  }
}

export interface HaAutomationRef {
  /** Id de configuración (el de la URL de /api/config/automation/config). */
  id: string;
  alias: string;
  /** Configuración tal cual la devuelve HA (triggers, conditions, actions…). */
  config: Record<string, unknown>;
}

/**
 * Automatizaciones de HA cuya configuración menciona una entidad, vengan de
 * donde vengan: las que crea la app, las huérfanas que se quedaron en HA sin
 * fila en la base de datos y las que se hayan hecho a mano desde HA.
 *
 * El estado de cada `automation.*` trae el id de configuración en sus
 * atributos; con él se lee la configuración y se busca la entidad en ella.
 */
export async function listHaAutomationsTargeting(entityId: string): Promise<HaAutomationRef[]> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) return [];
  const base = env.HA_BASE_URL.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${env.HA_TOKEN}` };

  const res = await fetch(`${base}/api/states`, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`HA states failed: ${res.status}`);
  const states = (await res.json()) as { entity_id: string; attributes?: Record<string, unknown> }[];

  const candidates = states
    .filter((s) => s.entity_id.startsWith('automation.') && typeof s.attributes?.id === 'string')
    .map((s) => ({
      id: s.attributes!.id as string,
      alias: typeof s.attributes?.friendly_name === 'string' ? s.attributes.friendly_name : s.entity_id,
    }));

  const checked = await Promise.all(
    candidates.map(async (c) => {
      try {
        const r = await fetch(`${base}/api/config/automation/config/${encodeURIComponent(c.id)}`, {
          headers,
          cache: 'no-store',
        });
        if (!r.ok) return null;
        // Comparación textual con comillas: "climate.thermostat" no debe
        // casar con "climate.thermostat_2".
        const text = await r.text();
        if (!text.includes(`"${entityId}"`)) return null;
        return { ...c, config: JSON.parse(text) as Record<string, unknown> };
      } catch {
        return null;
      }
    }),
  );
  return checked.filter((c): c is HaAutomationRef => c !== null);
}

async function reloadHaAutomations(base: string): Promise<void> {
  try {
    await fetch(`${base}/api/services/automation/reload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.HA_TOKEN!}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch {
    // Non-critical
  }
}
