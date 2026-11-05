'use server';

import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb, devices, acUnits, acSchedules } from '@pradomotica/db';
import { getActiveHouseholdId } from '@/lib/household';
import { newId } from '@/lib/id';
import { createHaAutomation, deleteHaAutomation } from '@/lib/ha';

export interface AcSchedule {
  id: string;
  daysOfWeek: number[];
  startTime: string;
  temperature: number | null;
  hvacMode: string;
  fanMode: string | null;
  haAutomationId: string | null;
  enabled: boolean;
}

const HA_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

async function getAuthorizedAcDevice(deviceId: string, userId: string) {
  const householdId = await getActiveHouseholdId(userId);
  if (!householdId) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: devices.id,
      name: devices.name,
      haEntityId: devices.haEntityId,
    })
    .from(devices)
    .innerJoin(acUnits, eq(acUnits.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);

  return row ?? null;
}

export async function getAcSchedules(deviceId: string): Promise<AcSchedule[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const device = await getAuthorizedAcDevice(deviceId, session.user.id);
  if (!device) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(acSchedules)
    .where(eq(acSchedules.deviceId, deviceId))
    .orderBy(acSchedules.startTime);

  return rows.map((r) => ({
    id: r.id,
    daysOfWeek: r.daysOfWeek,
    startTime: r.startTime,
    temperature: r.temperature,
    hvacMode: r.hvacMode,
    fanMode: r.fanMode,
    haAutomationId: r.haAutomationId,
    enabled: r.enabled,
  }));
}

const VALID_HVAC_MODES = ['cool', 'heat', 'fan_only', 'dry', 'off'] as const;
const VALID_FAN_MODES = ['quiet', 'low', 'medium_low', 'medium', 'medium_high', 'high', 'auto'] as const;

export async function addAcSchedule(
  deviceId: string,
  input: {
    daysOfWeek: number[];
    startTime: string;
    temperature: number | null;
    hvacMode: string;
    fanMode: string | null;
  },
): Promise<{ error?: string; schedule?: AcSchedule }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Unauthorized' };

  const { daysOfWeek, startTime, hvacMode, fanMode } = input;
  const temperature = input.temperature;

  if (!VALID_HVAC_MODES.includes(hvacMode as typeof VALID_HVAC_MODES[number])) {
    return { error: 'Modo HVAC no válido' };
  }
  if (fanMode && !VALID_FAN_MODES.includes(fanMode as typeof VALID_FAN_MODES[number])) {
    return { error: 'Modo de ventilador no válido' };
  }
  if (
    !Array.isArray(daysOfWeek) ||
    daysOfWeek.length === 0 ||
    daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    !/^\d{2}:\d{2}$/.test(startTime)
  ) {
    return { error: 'Datos inválidos' };
  }
  if (hvacMode !== 'off' && hvacMode !== 'fan_only' && (temperature === null || !Number.isFinite(temperature) || temperature < 10 || temperature > 35)) {
    return { error: 'Introduce una temperatura válida (10-35°C)' };
  }

  const device = await getAuthorizedAcDevice(deviceId, session.user.id);
  if (!device) return { error: 'Dispositivo no encontrado' };

  const id = newId();
  const haDays = daysOfWeek.map((d) => HA_DAYS[d]);
  const dayLabel = daysOfWeek.map((d) => DAY_LABELS_ES[d]).join('/');

  let haAction: unknown[];
  if (hvacMode === 'off') {
    haAction = [
      {
        action: 'climate.set_hvac_mode',
        target: { entity_id: device.haEntityId },
        data: { hvac_mode: 'off' },
      },
    ];
  } else {
    haAction = [];
    if (temperature != null) {
      haAction.push({
        action: 'climate.set_temperature',
        target: { entity_id: device.haEntityId },
        data: { temperature },
      });
    }
    if (hvacMode !== 'cool') {
      // Set HVAC mode if not default cool
      haAction.unshift({
        action: 'climate.set_hvac_mode',
        target: { entity_id: device.haEntityId },
        data: { hvac_mode: hvacMode },
      });
    } else {
      haAction.unshift({
        action: 'climate.set_hvac_mode',
        target: { entity_id: device.haEntityId },
        data: { hvac_mode: 'cool' },
      });
    }
    if (fanMode) {
      haAction.push({
        action: 'climate.set_fan_mode',
        target: { entity_id: device.haEntityId },
        data: { fan_mode: fanMode },
      });
    }
  }

  let haAutomationId: string | null = null;
  if (device.haEntityId) {
    const ok = await createHaAutomation(id, {
      alias: `Avyra: ${device.name} - ${dayLabel} ${startTime}`,
      description: 'Gestionado por Avyra — no editar manualmente',
      mode: 'single',
      trigger: [{ trigger: 'time', at: `${startTime}:00` }],
      condition: [{ condition: 'time', weekday: haDays }],
      action: haAction,
    });
    if (ok) haAutomationId = id;
  }

  try {
    const db = getDb();
    await db.insert(acSchedules).values({
      id,
      deviceId,
      daysOfWeek,
      startTime,
      temperature: temperature ?? null,
      hvacMode,
      fanMode: fanMode ?? null,
      haAutomationId,
      enabled: true,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('[addAcSchedule] DB error:', err);
    return { error: 'Error al guardar la programación.' };
  }

  return {
    schedule: {
      id,
      daysOfWeek,
      startTime,
      temperature: temperature ?? null,
      hvacMode,
      fanMode: fanMode ?? null,
      haAutomationId,
      enabled: true,
    },
  };
}

export async function deleteAcSchedule(
  scheduleId: string,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Unauthorized' };

  const db = getDb();

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: 'No hay hogar configurado' };

  const [row] = await db
    .select({ haAutomationId: acSchedules.haAutomationId })
    .from(acSchedules)
    .innerJoin(devices, eq(devices.id, acSchedules.deviceId))
    .where(
      and(
        eq(acSchedules.id, scheduleId),
        eq(devices.householdId, householdId),
      ),
    )
    .limit(1);

  if (!row) return { error: 'Programación no encontrada' };

  if (row.haAutomationId) {
    await deleteHaAutomation(row.haAutomationId);
  }

  await db.delete(acSchedules).where(eq(acSchedules.id, scheduleId));

  return {};
}
