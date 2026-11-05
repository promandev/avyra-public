import 'server-only';

import { eq } from 'drizzle-orm';

import { getDb, devices, thermostats, thermostatSchedules } from '@pradomotica/db';
import { createHaAutomation, deleteHaAutomation, type HaAutomationConfig } from './ha';

/**
 * Las rutinas del termostato viven en dos sitios: la fila de la app, con la
 * consigna en grados de pantalla, y una automatización de HA que lleva la
 * entidad y la consigna ya pasada a unidades de HA con la escala del aparato.
 * Este módulo es el único que traduce lo primero a lo segundo. No es un
 * fichero 'use server' a propósito: ahí cada función exportada sería una
 * acción que cualquiera podría llamar desde el navegador.
 */

export const HA_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

// Day names used in HA automation alias (human-readable).
const DAY_LABELS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

export interface ScheduleAutomationInput {
  daysOfWeek: number[];
  startTime: string;
  /** Grados de pantalla; null en las rutinas de apagar. */
  temperature: number | null;
  hvacMode: string;
}

export function scheduleAutomationConfig(
  device: { name: string; haEntityId: string; temperatureScale: number | null },
  schedule: ScheduleAutomationInput,
): HaAutomationConfig {
  const scale = device.temperatureScale ?? 1;
  const haTemperature =
    schedule.temperature != null ? Number((schedule.temperature / scale).toFixed(2)) : null;
  const dayLabel = schedule.daysOfWeek.map((d) => DAY_LABELS_ES[d]).join('/');

  const action =
    schedule.hvacMode === 'off'
      ? {
          action: 'climate.set_hvac_mode',
          target: { entity_id: device.haEntityId },
          data: { hvac_mode: 'off' },
        }
      : {
          action: 'climate.set_temperature',
          target: { entity_id: device.haEntityId },
          data: { temperature: haTemperature },
        };

  return {
    alias: `Avyra: ${device.name} - ${dayLabel} ${schedule.startTime}`,
    description: 'Gestionado por Avyra — no editar manualmente',
    mode: 'single',
    trigger: [{ trigger: 'time', at: `${schedule.startTime}:00` }],
    condition: [{ condition: 'time', weekday: schedule.daysOfWeek.map((d) => HA_DAYS[d]) }],
    action: [action],
  };
}

/**
 * Reescribe en HA las automatizaciones de todas las rutinas de un termostato
 * con su entidad, nombre y escala actuales. Sin esto, cambiar la entidad (al
 * pasar el termostato de la nube de Tuya a tuya-local, por ejemplo) dejaba las
 * rutinas mandando órdenes a la entidad vieja, con la escala vieja.
 *
 * Reutiliza el id de cada automatización, así que se sobrescriben en vez de
 * duplicarse, y repetirlo no hace daño. Sin entidad, las automatizaciones se
 * borran: no tendrían a quién mandar nada.
 *
 * Devuelve cuántas no se pudieron escribir.
 */
export async function syncScheduleAutomations(deviceId: string): Promise<{ failed: number }> {
  const db = getDb();
  const [device] = await db
    .select({ name: devices.name, haEntityId: devices.haEntityId, temperatureScale: thermostats.temperatureScale })
    .from(devices)
    .innerJoin(thermostats, eq(thermostats.deviceId, devices.id))
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (!device) return { failed: 0 };

  const rows = await db
    .select()
    .from(thermostatSchedules)
    .where(eq(thermostatSchedules.deviceId, deviceId));

  let failed = 0;
  for (const row of rows) {
    if (!device.haEntityId) {
      if (row.haAutomationId) {
        await deleteHaAutomation(row.haAutomationId);
        await db
          .update(thermostatSchedules)
          .set({ haAutomationId: null })
          .where(eq(thermostatSchedules.id, row.id));
      }
      continue;
    }

    const automationId = row.haAutomationId ?? row.id;
    const ok = await createHaAutomation(
      automationId,
      scheduleAutomationConfig({ ...device, haEntityId: device.haEntityId }, row),
    );
    if (!ok) {
      failed++;
      continue;
    }
    if (row.haAutomationId !== automationId) {
      await db
        .update(thermostatSchedules)
        .set({ haAutomationId: automationId })
        .where(eq(thermostatSchedules.id, row.id));
    }
  }
  return { failed };
}
