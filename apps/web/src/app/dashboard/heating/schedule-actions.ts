'use server';

import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb, devices, thermostats, thermostatSchedules } from '@pradomotica/db';
import { getActiveHouseholdId } from '@/lib/household';
import { newId } from '@/lib/id';
import {
  callHaService,
  createHaAutomation,
  deleteHaAutomation,
  getRawEntityState,
  listHaAutomationsTargeting,
  type HaAutomationRef,
} from '@/lib/ha';
import { suppressDeviceAlerts } from '@/lib/device-alerts';
import { HA_DAYS, scheduleAutomationConfig } from '@/lib/thermostat-schedules';

export interface Schedule {
  id: string;
  daysOfWeek: number[];
  startTime: string;
  temperature: number | null;
  hvacMode: string;
  haAutomationId: string | null;
  enabled: boolean;
  /** Sólo existe en Home Assistant, sin fila en la app (huérfana o hecha a mano). */
  haOnly?: boolean;
}

async function getAuthorizedDevice(deviceId: string, userId: string) {
  const householdId = await getActiveHouseholdId(userId);
  if (!householdId) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: devices.id,
      name: devices.name,
      haEntityId: devices.haEntityId,
      temperatureScale: thermostats.temperatureScale,
    })
    .from(devices)
    .innerJoin(thermostats, eq(thermostats.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);

  return row ?? null;
}

/**
 * Devuelve el error en lugar de lanzarlo: una excepción en una server action
 * llega al cliente en producción como el genérico "An error occurred in the
 * Server Components render", que no dice nada.
 */
export async function getSchedules(
  deviceId: string,
): Promise<{ schedules: Schedule[]; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { schedules: [] };

  try {
    const device = await getAuthorizedDevice(deviceId, session.user.id);
    if (!device) return { schedules: [] };

    const db = getDb();
    const rows = await db
      .select()
      .from(thermostatSchedules)
      .where(eq(thermostatSchedules.deviceId, deviceId))
      .orderBy(thermostatSchedules.startTime);

    const schedules = rows.map(toSchedule);
    const haOnly = await getHaOnlySchedules(device, schedules);
    return {
      schedules: [...schedules, ...haOnly].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    };
  } catch (err) {
    console.error('[getSchedules] DB error:', err);
    return { schedules: [], error: 'No se pudieron cargar las programaciones.' };
  }
}

/**
 * Automatizaciones de HA que actúan sobre el termostato pero no tienen fila en
 * la app: las que quedaron huérfanas cuando el guardado fallaba (v0.12 y
 * antes) o las hechas a mano en HA. Sin esto no se veían en ningún sitio y
 * seguían cambiando la consigna (una de ellas lo dejaba en 17,5 °C cada noche).
 * Si HA no responde se devuelve vacío: la lista de la app sigue sirviendo.
 */
async function getHaOnlySchedules(
  device: { haEntityId: string | null; temperatureScale: number | null },
  known: Schedule[],
): Promise<Schedule[]> {
  if (!device.haEntityId) return [];
  const knownIds = new Set(known.map((s) => s.haAutomationId).filter(Boolean));
  const scale = device.temperatureScale ?? 1;

  let automations: HaAutomationRef[];
  try {
    automations = await listHaAutomationsTargeting(device.haEntityId);
  } catch (err) {
    console.error('[getSchedules] HA list error:', err instanceof Error ? err.message : err);
    return [];
  }

  return automations
    .filter((a) => !knownIds.has(a.id))
    .map((a) => ({ ...parseHaSchedule(a.config, scale), id: a.id, haAutomationId: a.id, haOnly: true }));
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

/** Lee hora, días y consigna de una automatización con la forma que crea la app. */
function parseHaSchedule(
  config: Record<string, unknown>,
  scale: number,
): Omit<Schedule, 'id' | 'haAutomationId' | 'haOnly'> {
  const triggers = asArray(config.triggers ?? config.trigger);
  const at = triggers.map((t) => t.at).find((v): v is string => typeof v === 'string');
  const startTime = at ? at.slice(0, 5) : '--:--';

  const weekdays = asArray(config.conditions ?? config.condition)
    .flatMap((c) => (Array.isArray(c.weekday) ? c.weekday : typeof c.weekday === 'string' ? [c.weekday] : []))
    .map((d) => HA_DAYS.indexOf(d as (typeof HA_DAYS)[number]))
    .filter((i) => i >= 0);
  const daysOfWeek = weekdays.length > 0 ? [...new Set(weekdays)].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];

  let temperature: number | null = null;
  let hvacMode = 'heat';
  for (const action of asArray(config.actions ?? config.action)) {
    const service = action.action ?? action.service;
    const data = (action.data ?? {}) as Record<string, unknown>;
    if (service === 'climate.set_temperature' && typeof data.temperature === 'number') {
      temperature = Number((data.temperature * scale).toFixed(1));
    }
    if (service === 'climate.set_hvac_mode' && data.hvac_mode === 'off') hvacMode = 'off';
  }

  return { daysOfWeek, startTime, temperature, hvacMode, enabled: config.enabled !== false };
}

/**
 * Borra una automatización que sólo existe en HA. Antes comprueba que de
 * verdad actúa sobre un termostato de este hogar: el id llega del cliente.
 */
export async function deleteHaOnlySchedule(
  deviceId: string,
  automationId: string,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Unauthorized' };

  const device = await getAuthorizedDevice(deviceId, session.user.id);
  if (!device?.haEntityId) return { error: 'Dispositivo no encontrado' };

  try {
    const targeting = await listHaAutomationsTargeting(device.haEntityId);
    if (!targeting.some((a) => a.id === automationId)) return { error: 'Programación no encontrada' };
  } catch {
    return { error: 'No se pudo consultar Home Assistant. Inténtalo de nuevo.' };
  }

  await deleteHaAutomation(automationId);
  return {};
}

function toSchedule(r: typeof thermostatSchedules.$inferSelect): Schedule {
  return {
    id: r.id,
    daysOfWeek: r.daysOfWeek,
    startTime: r.startTime,
    temperature: r.temperature,
    hvacMode: r.hvacMode,
    haAutomationId: r.haAutomationId,
    enabled: r.enabled,
  };
}

export async function addSchedule(
  deviceId: string,
  input: { daysOfWeek: number[]; startTime: string; temperature: number | null; hvacMode: string },
): Promise<{ error?: string; schedule?: Schedule }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Unauthorized' };

  const { daysOfWeek, startTime, hvacMode } = input;
  const temperature = input.temperature;

  if (hvacMode !== 'heat' && hvacMode !== 'off') {
    return { error: 'Modo HVAC no válido' };
  }
  if (
    !Array.isArray(daysOfWeek) ||
    daysOfWeek.length === 0 ||
    daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    !/^\d{2}:\d{2}$/.test(startTime)
  ) {
    return { error: 'Datos inválidos' };
  }
  if (hvacMode === 'heat' && (temperature === null || !Number.isFinite(temperature) || temperature < 1 || temperature > 500)) {
    return { error: 'Introduce una temperatura válida para el modo calor' };
  }

  const device = await getAuthorizedDevice(deviceId, session.user.id);
  if (!device) return { error: 'Dispositivo no encontrado' };

  const id = newId();

  let haAutomationId: string | null = null;
  if (device.haEntityId) {
    const ok = await createHaAutomation(
      id,
      scheduleAutomationConfig(
        { ...device, haEntityId: device.haEntityId },
        { daysOfWeek, startTime, temperature, hvacMode },
      ),
    );
    if (ok) haAutomationId = id;
  }

  try {
    const db = getDb();
    await db.insert(thermostatSchedules).values({
      id,
      deviceId,
      daysOfWeek,
      startTime,
      temperature: temperature ?? null,
      hvacMode,
      haAutomationId,
      enabled: true,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('[addSchedule] DB error:', err);
    // La automatización ya está en HA: sin fila que la represente, la app no
    // la enseñaría ni podría borrarla, pero seguiría cambiando la consigna.
    if (haAutomationId) await deleteHaAutomation(haAutomationId);
    return { error: 'Error al guardar la programación. Las migraciones pueden estar pendientes.' };
  }

  return {
    schedule: {
      id,
      daysOfWeek,
      startTime,
      temperature: temperature ?? null,
      hvacMode,
      haAutomationId,
      enabled: true,
    },
  };
}

export async function deleteSchedule(
  scheduleId: string,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Unauthorized' };

  const db = getDb();

  // Verify ownership by joining through devices → household.
  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: 'No hay hogar configurado' };

  const [row] = await db
    .select({ haAutomationId: thermostatSchedules.haAutomationId })
    .from(thermostatSchedules)
    .innerJoin(devices, eq(devices.id, thermostatSchedules.deviceId))
    .where(
      and(
        eq(thermostatSchedules.id, scheduleId),
        eq(devices.householdId, householdId),
      ),
    )
    .limit(1);

  if (!row) return { error: 'Programación no encontrada' };

  // Delete HA automation if one was created.
  if (row.haAutomationId) {
    await deleteHaAutomation(row.haAutomationId);
  }

  await db.delete(thermostatSchedules).where(eq(thermostatSchedules.id, scheduleId));

  return {};
}

export interface ClearSchedulesResult {
  error?: string;
  /** Automatizaciones de HA borradas (las de la app y cualquier otra que toque el termostato). */
  removed?: number;
  /** El termostato estaba en su programa interno ('auto') y se ha pasado a manual. */
  manualMode?: boolean;
}

/**
 * Deja el termostato sin ninguna rutina: borra las programaciones de la app,
 * cualquier automatización de HA que lo mencione (incluidas las huérfanas que
 * no tienen fila aquí) y, si está siguiendo el programa semanal interno del
 * propio aparato, lo pasa a modo manual.
 */
export async function clearAllSchedules(deviceId: string): Promise<ClearSchedulesResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Unauthorized' };

  const device = await getAuthorizedDevice(deviceId, session.user.id);
  if (!device) return { error: 'Dispositivo no encontrado' };

  const db = getDb();
  const ids = new Set<string>();

  try {
    const rows = await db
      .select({ haAutomationId: thermostatSchedules.haAutomationId })
      .from(thermostatSchedules)
      .where(eq(thermostatSchedules.deviceId, deviceId));
    for (const r of rows) if (r.haAutomationId) ids.add(r.haAutomationId);
  } catch (err) {
    // Con la tabla sin migrar no hay filas que leer, pero en HA sí puede haber
    // rutinas: se sigue para borrar esas.
    console.error('[clearAllSchedules] DB read error:', err);
  }

  let manualMode = false;
  if (device.haEntityId) {
    try {
      for (const a of await listHaAutomationsTargeting(device.haEntityId)) ids.add(a.id);
    } catch (err) {
      console.error('[clearAllSchedules] HA list error:', err);
      return { error: 'No se pudo consultar Home Assistant. Inténtalo de nuevo.' };
    }

    const raw = await getRawEntityState(device.haEntityId);
    const modes = Array.isArray(raw?.attributes?.hvac_modes) ? (raw.attributes.hvac_modes as string[]) : [];
    if (raw?.state === 'auto' && modes.includes('heat')) {
      suppressDeviceAlerts(deviceId);
      try {
        await callHaService('climate', 'set_hvac_mode', device.haEntityId, { hvac_mode: 'heat' });
        manualMode = true;
      } catch (err) {
        console.error('[clearAllSchedules] set manual mode failed:', err);
      }
    }
  }

  for (const id of ids) await deleteHaAutomation(id);

  try {
    await db.delete(thermostatSchedules).where(eq(thermostatSchedules.deviceId, deviceId));
  } catch (err) {
    console.error('[clearAllSchedules] DB delete error:', err);
  }

  return { removed: ids.size, manualMode };
}
