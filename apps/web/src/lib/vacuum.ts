/**
 * Robot aspirador: tipos y utilidades puras, compartidas por servidor y cliente.
 *
 * No hay nada de base de datos ni de Home Assistant aquí a propósito: la
 * tarjeta del cliente necesita las mismas reglas (qué potencia es "Eco") que
 * las acciones y las programaciones del servidor, y deben coincidir.
 */

export type VacuumDirection = 'forward' | 'reverse' | 'left' | 'right' | 'stop';
export type VacuumCleanMode = 'auto' | 'eco';
export const VACUUM_CLEAN_MODES: readonly VacuumCleanMode[] = ['auto', 'eco'];

/**
 * Nombres que acepta `vacuum.send_command` para cada movimiento, por orden de
 * preferencia. tuya-local no es uniforme entre perfiles: la Conga 1090 y la X70
 * usan `left`/`right` y la S1970 `turn_left`/`turn_right`.
 *
 * El orden importa poco para acertar y mucho para la espera: tuya-local IGNORA
 * EN SILENCIO un nombre que su perfil no conoce, así que el acierto se confirma
 * releyendo la entidad (ver `driveVacuum`) y el primero de la lista es el que
 * ahorra esa comprobación al robot más común.
 */
export const DIRECTION_COMMANDS: Record<VacuumDirection, readonly string[]> = {
  forward: ['forward'],
  reverse: ['reverse', 'backward'],
  left: ['left', 'turn_left'],
  right: ['right', 'turn_right'],
  stop: ['stop'],
};

export interface WaterTankReading {
  /** 0-1 para pintar el depósito; null si el estado no se puede cuantificar. */
  fraction: number | null;
  /** true/false si la entidad sólo dice si el depósito está puesto; null si es un nivel. */
  installed: boolean | null;
  /** Estado crudo, para enseñarlo cuando no es binario. */
  label: string;
  unavailable: boolean;
}

export interface VacuumLiveState {
  /** Estado de la entidad vacuum: cleaning, docked, returning, paused, idle, error… */
  state: string;
  fanSpeed: string | null;
  fanSpeedList: string[];
  battery: number | null;
  /** null cuando no hay entidad de depósito configurada. */
  waterTank: WaterTankReading | null;
}

/** Una limpieza registrada, ya serializada para el cliente. */
export interface VacuumSession {
  id: string;
  startedAt: string;
  /** Null mientras sigue limpiando. */
  endedAt: string | null;
  batteryStart: number | null;
  /** Última lectura antes de volver a la base, no la de ya cargando. */
  batteryEnd: number | null;
  cleanMinutes: number | null;
  /** Null si el robot no informa de superficie o no la cambió durante la sesión. */
  cleanArea: number | null;
  /** Estado con el que terminó: docked, idle, error… */
  endState: string | null;
}

export function readFanSpeedList(attributes: Record<string, unknown> | undefined): string[] {
  const raw = attributes?.fan_speed_list;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

function isOffSpeed(speed: string): boolean {
  return /^(off|closed?|none|0)$/i.test(speed.trim());
}

function pickByHints(list: string[], hints: readonly string[], fallbackIndex: number): string | null {
  const usable = list.filter((s) => !isOffSpeed(s));
  if (usable.length === 0) return null;
  for (const hint of hints) {
    const match = usable.find((s) => s.trim().toLowerCase() === hint);
    if (match) return match;
  }
  return usable[Math.min(fallbackIndex, usable.length - 1)] ?? null;
}

/** La potencia más suave que no sea apagar la succión. */
export function pickEcoFanSpeed(list: string[]): string | null {
  return pickByHints(list, ['eco', 'quiet', 'silent', 'gentle', 'low', '1'], 0);
}

/**
 * La potencia del modo Auto: la de trabajo normal y, si el robot no tiene una
 * que se llame así, la más fuerte.
 *
 * Incluye "medium" porque es el nombre que le da tuya-local al nivel normal:
 * verificado en directo con la Conga 1090, que limpia en `FANNORAM` y lo
 * publica como Medium. El esquema de la nube de Tuya sólo declaraba dos
 * niveles para ese modelo, pero los tres funcionan.
 */
export function pickStandardFanSpeed(list: string[]): string | null {
  return pickByHints(list, ['normal', 'standard', 'medium', 'auto'], Number.MAX_SAFE_INTEGER);
}

/** `medium_high` → `Medium high`. Las potencias llegan con el nombre del perfil de tuya-local. */
export function humanizeValue(value: string): string {
  const text = value.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Interpreta la entidad del depósito, sea cual sea su forma:
 * - binary_sensor / switch: depósito o fregona colocados sí/no.
 * - number / sensor numérico: nivel con min/max o en %.
 * - select: nivel de agua por pasos (off, low, medium, high…).
 */
export function parseWaterTank(
  entityId: string,
  state: string,
  attributes: Record<string, unknown>,
): WaterTankReading {
  if (state === 'unavailable' || state === 'unknown') {
    return { fraction: null, installed: null, label: state, unavailable: true };
  }

  const domain = entityId.split('.')[0];
  if (domain === 'binary_sensor' || domain === 'switch' || domain === 'input_boolean') {
    const on = state === 'on';
    return { fraction: on ? 1 : 0, installed: on, label: state, unavailable: false };
  }

  const numeric = Number(state);
  if (state.trim() !== '' && Number.isFinite(numeric)) {
    const min = typeof attributes.min === 'number' ? attributes.min : 0;
    const max =
      typeof attributes.max === 'number'
        ? attributes.max
        : attributes.unit_of_measurement === '%'
          ? 100
          : null;
    const fraction = max !== null && max > min ? (numeric - min) / (max - min) : null;
    return {
      fraction: fraction === null ? null : Math.min(1, Math.max(0, fraction)),
      installed: null,
      label: state,
      unavailable: false,
    };
  }

  const options = Array.isArray(attributes.options)
    ? attributes.options.filter((o): o is string => typeof o === 'string')
    : [];
  const index = options.indexOf(state);
  let fraction: number | null = null;
  if (isOffSpeed(state)) fraction = 0;
  else if (index >= 0 && options.length > 1) fraction = index / (options.length - 1);

  return { fraction, installed: null, label: state, unavailable: false };
}
