/**
 * Lectura en vivo del hogar.
 *
 * Una sola pasada a base de datos y a Home Assistant produce el detalle de
 * cada aparato (`HouseOverview`), del que se deriva el "pulso" (`HomePulse`),
 * que es sólo el recuento. Así:
 *  - la capa ambiental, los puntos del menú y la portada leen lo mismo, y
 *  - el layout y la portada, que se renderizan en la misma petición, no
 *    duplican ninguna llamada: todo pasa por funciones envueltas en `cache`.
 *
 * Todo es tolerante a fallos: si Home Assistant no responde, se devuelve el
 * inventario vacío en lugar de romper la página. Los tipos viven en
 * `home-pulse-types.ts` para que el cliente pueda usarlos sin arrastrar la base
 * de datos.
 */

import { cache } from 'react';
import { desc, eq } from 'drizzle-orm';

import { getDb, cameraMotionEvents, cameras, devices, thermostats, vacuums } from '@pradomotica/db';
import { TABLET_CAMERA_MODEL } from './camera-access';
import {
  getClimateEntityStates,
  getEntityStates,
  getRawEntityState,
  type HaClimateState,
} from './ha';
import {
  EMPTY_OVERVIEW,
  EMPTY_PULSE,
  type ClimateOverview,
  type HomePulse,
  type HouseOverview,
  type LightOverview,
  type VacuumOverview,
} from './home-pulse-types';

export { EMPTY_PULSE, EMPTY_OVERVIEW };
export type { HomePulse, SubsystemPulse, HouseOverview } from './home-pulse-types';

/**
 * Techo de espera. Esta lectura pinta el fondo y los puntos del menú, así que
 * nunca debe retrasar la navegación. Si Home Assistant tarda más que esto, la
 * interfaz sale en reposo y ya se corregirá al siguiente refresco.
 */
const PULSE_TIMEOUT_MS = 2500;

/**
 * Margen para no encender el aviso por una décima de diferencia. Sin él, un
 * termostato que oscila alrededor de su consigna parpadearía sin parar.
 */
const DEADBAND_C = 0.2;

function isPowered(state: string | undefined): boolean {
  return !!state && state !== 'off' && state !== 'unavailable' && state !== 'unknown';
}

/**
 * ¿Está el aparato DANDO servicio ahora mismo?
 *
 * No es lo mismo que estar encendido. Un termostato en modo calor que ya ha
 * alcanzado su consigna sigue encendido, pero no está calentando nada, y la
 * casa no debería pintarse de naranja por ello.
 *
 * Dos vías, por orden de fiabilidad:
 *  1. `hvac_action`, que es Home Assistant diciéndolo explícitamente.
 *  2. Si el aparato no lo reporta (los termostatos baratos no suelen hacerlo),
 *     se deduce comparando consigna y temperatura del cuarto.
 */
function isRunning(climate: HaClimateState | undefined, mode: 'heat' | 'cool', target: number | null): boolean {
  if (!climate || !isPowered(climate.state)) return false;

  if (climate.hvacAction) {
    return mode === 'heat' ? climate.hvacAction === 'heating' : climate.hvacAction === 'cooling';
  }

  if (climate.currentTemperature === null || target === null) return false;
  return mode === 'heat'
    ? target > climate.currentTemperature + DEADBAND_C
    : target < climate.currentTemperature - DEADBAND_C;
}

function numericState(state: string | undefined): number | null {
  if (state === undefined || state.trim() === '') return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

async function readOverview(householdId: string): Promise<HouseOverview> {
  const db = getDb();
  // Los left join traen lo que cada tipo necesita: el modelo de cámara (que
  // distingue la de la tablet), la escala de consigna del termostato y la
  // entidad de batería del robot. Todas las tablas hijas tienen `deviceId`
  // como clave primaria, así que las uniones son 1:1 y no duplican filas.
  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      type: devices.type,
      enabled: devices.enabled,
      haEntityId: devices.haEntityId,
      cameraModel: cameras.model,
      thermostatScale: thermostats.temperatureScale,
      vacuumBatteryEntityId: vacuums.batteryEntityId,
    })
    .from(devices)
    .leftJoin(cameras, eq(cameras.deviceId, devices.id))
    .leftJoin(thermostats, eq(thermostats.deviceId, devices.id))
    .leftJoin(vacuums, eq(vacuums.deviceId, devices.id))
    .where(eq(devices.householdId, householdId))
    .orderBy(devices.createdAt);

  const lightRows = rows.filter((r) => r.type === 'light');
  const climateRows = rows.filter((r) => r.type === 'thermostat' || r.type === 'ac');
  const vacuumRows = rows.filter((r) => r.type === 'vacuum');
  const cameraRows = rows.filter((r) => r.type === 'camera' && r.cameraModel !== TABLET_CAMERA_MODEL);

  const entityIds = (list: typeof rows) =>
    list.map((r) => r.haEntityId).filter((id): id is string => !!id);

  // Cuatro lecturas en paralelo. Las dos primeras devuelven {} si Home Assistant
  // no está configurado o no responde; cualquier otro fallo lo recoge el catch
  // de `getHouseOverview`.
  const [lightStates, climateStates, vacuumStates, lastEvents] = await Promise.all([
    getEntityStates(entityIds(lightRows)),
    getClimateEntityStates(entityIds(climateRows)),
    Promise.all(
      vacuumRows.map(async (r) => {
        if (!r.haEntityId) return null;
        const [main, battery] = await Promise.all([
          getRawEntityState(r.haEntityId),
          r.vacuumBatteryEntityId ? getRawEntityState(r.vacuumBatteryEntityId) : null,
        ]);
        return { main, battery };
      }),
    ),
    // Último aviso de cada cámara. Hay índice por (cámara, fecha), así que es
    // una lectura directa aunque la tabla crezca.
    Promise.all(
      cameraRows.map(async (r) => {
        const [ev] = await db
          .select({ at: cameraMotionEvents.occurredAt, type: cameraMotionEvents.type })
          .from(cameraMotionEvents)
          .where(eq(cameraMotionEvents.deviceId, r.id))
          .orderBy(desc(cameraMotionEvents.occurredAt))
          .limit(1);
        return ev ?? null;
      }),
    ),
  ]);

  const lights: LightOverview[] = lightRows.map((r) => {
    const state = r.haEntityId ? lightStates[r.haEntityId] : undefined;
    return {
      id: r.id,
      name: r.name,
      on: state === 'on',
      controllable: !!r.haEntityId,
      available: !!state && state !== 'unavailable' && state !== 'unknown',
    };
  });

  const climate: ClimateOverview[] = climateRows.map((r) => {
    const kind = r.type === 'thermostat' ? 'heat' : 'cool';
    const state = r.haEntityId ? climateStates[r.haEntityId] : undefined;
    // La consigna del termostato se corrige con su escala, igual que en su
    // pantalla; si no, compararla con la temperatura del cuarto sale mal.
    const scale = kind === 'heat' ? (r.thermostatScale ?? 1) : 1;
    const target =
      state?.targetTemperature !== null && state?.targetTemperature !== undefined
        ? Number((state.targetTemperature * scale).toFixed(1))
        : null;
    return {
      id: r.id,
      name: r.name,
      kind,
      power: isPowered(state?.state),
      running: isRunning(state, kind, target),
      current: state?.currentTemperature ?? null,
      target,
    };
  });

  const vacuumList: VacuumOverview[] = vacuumRows.map((r, i) => {
    const live = vacuumStates[i];
    const attrs = live?.main?.attributes ?? {};
    // tuya-local publica la batería como sensor aparte; otras integraciones
    // la dejan como atributo de la entidad vacuum.
    const battery =
      numericState(live?.battery?.state) ??
      (typeof attrs.battery_level === 'number' ? attrs.battery_level : null);
    return {
      id: r.id,
      name: r.name,
      state: live?.main?.state ?? 'unavailable',
      battery: battery === null ? null : Math.round(battery),
    };
  });

  const readings = climate
    .map((c) => c.current)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));

  return {
    lights,
    climate,
    cameras: cameraRows.map((r, i) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      lastEventAt: lastEvents[i]?.at ? lastEvents[i]!.at.toISOString() : null,
      lastEventType: lastEvents[i]?.type ?? null,
    })),
    vacuums: vacuumList,
    indoorTemperature:
      readings.length > 0
        ? Number((readings.reduce((sum, t) => sum + t, 0) / readings.length).toFixed(1))
        : null,
  };
}

/**
 * Detalle por aparato del hogar activo. Envuelto en `cache` para que el layout
 * (fondo y menú) y la portada compartan una única lectura por petición.
 */
export const getHouseOverview = cache(async (householdId: string | null): Promise<HouseOverview> => {
  if (!householdId) return EMPTY_OVERVIEW;

  const timeout = new Promise<HouseOverview>((resolve) => {
    setTimeout(() => resolve(EMPTY_OVERVIEW), PULSE_TIMEOUT_MS);
  });

  return Promise.race([readOverview(householdId).catch(() => EMPTY_OVERVIEW), timeout]);
});

/** Resume el detalle en recuentos. No hace ninguna llamada nueva. */
export function pulseFromOverview(overview: HouseOverview): HomePulse {
  const heating = overview.climate.filter((c) => c.kind === 'heat');
  const cooling = overview.climate.filter((c) => c.kind === 'cool');

  const lightsOn = overview.lights.filter((l) => l.on).length;
  const heatingOn = heating.filter((c) => c.running).length;
  const coolingOn = cooling.filter((c) => c.running).length;

  return {
    lights: { total: overview.lights.length, active: lightsOn },
    heating: { total: heating.length, active: heatingOn },
    cooling: { total: cooling.length, active: coolingOn },
    // Una cámara dada de alta se considera en servicio: su estado real vive
    // en el agente de cada cámara, no en Home Assistant.
    cameras: { total: overview.cameras.length, active: overview.cameras.length },
    indoorTemperature: overview.indoorTemperature,
    anyActive: lightsOn > 0 || heatingOn > 0 || coolingOn > 0,
  };
}

/** Recuentos del hogar activo: fondo ambiental y puntos del menú. */
export const getHomePulse = cache(async (householdId: string | null): Promise<HomePulse> => {
  return pulseFromOverview(await getHouseOverview(householdId));
});
