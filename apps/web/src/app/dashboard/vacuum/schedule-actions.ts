'use server';

import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId } from '@/lib/household';
import { createHaAutomation, deleteHaAutomation, getRawEntityState } from '@/lib/ha';
import { newId } from '@/lib/id';
import {
  VACUUM_CLEAN_MODES,
  pickEcoFanSpeed,
  pickStandardFanSpeed,
  readFanSpeedList,
  type VacuumCleanMode,
} from '@/lib/vacuum';
import { getDb, devices, vacuums, vacuumSchedules } from '@pradomotica/db';

export interface VacuumSchedule {
  id: string;
  daysOfWeek: number[];
  startTime: string;
  /** Hora a la que vuelve a la base. null = termina el ciclo por su cuenta. */
  endTime: string | null;
  cleanMode: VacuumCleanMode;
  haAutomationId: string | null;
  enabled: boolean;
}

const HA_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function getAuthorizedVacuumDevice(deviceId: string, userId: string) {
  const householdId = await getActiveHouseholdId(userId);
  if (!householdId) return null;

  const db = getDb();
  const [row] = await db
    .select({ id: devices.id, name: devices.name, haEntityId: devices.haEntityId })
    .from(devices)
    .innerJoin(vacuums, eq(vacuums.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);

  return row ?? null;
}

function toCleanMode(value: string): VacuumCleanMode {
  return (VACUUM_CLEAN_MODES as readonly string[]).includes(value) ? (value as VacuumCleanMode) : 'auto';
}

export async function getVacuumSchedules(deviceId: string): Promise<VacuumSchedule[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const device = await getAuthorizedVacuumDevice(deviceId, session.user.id);
  if (!device) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(vacuumSchedules)
    .where(eq(vacuumSchedules.deviceId, deviceId))
    .orderBy(vacuumSchedules.startTime);

  return rows.map((r) => ({
    id: r.id,
    daysOfWeek: r.daysOfWeek,
    startTime: r.startTime,
    endTime: r.endTime,
    cleanMode: toCleanMode(r.cleanMode),
    haAutomationId: r.haAutomationId,
    enabled: r.enabled,
  }));
}

export async function addVacuumSchedule(
  deviceId: string,
  input: {
    daysOfWeek: number[];
    startTime: string;
    endTime: string | null;
    cleanMode: VacuumCleanMode;
  },
): Promise<{ error?: string; schedule?: VacuumSchedule }> {
  const tc = await getTranslations('common');
  const tv = await getTranslations('vacuum');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const { daysOfWeek, startTime, endTime, cleanMode } = input;

  if (
    !Array.isArray(daysOfWeek) ||
    daysOfWeek.length === 0 ||
    daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    typeof startTime !== 'string' ||
    !TIME.test(startTime) ||
    (endTime !== null && (typeof endTime !== 'string' || !TIME.test(endTime))) ||
    !VACUUM_CLEAN_MODES.includes(cleanMode)
  ) {
    return { error: tv('slotInvalidData') };
  }
  // La franja es del mismo día: la condición de día de la semana se evalúa
  // en cada disparo, y una vuelta pasada la medianoche caería en otro día.
  if (endTime !== null && endTime <= startTime) {
    return { error: tv('slotEndBeforeStart') };
  }

  const device = await getAuthorizedVacuumDevice(deviceId, session.user.id);
  if (!device) return { error: tc('notFound') };

  const id = newId();
  const days = [...new Set(daysOfWeek)].sort((a, b) => a - b);

  let haAutomationId: string | null = null;
  if (device.haEntityId) {
    const target = { entity_id: device.haEntityId };

    // La potencia se resuelve ahora, con la lista que anuncia el robot, para
    // que la automatización no dependa de Avyra cuando se dispare.
    const raw = await getRawEntityState(device.haEntityId);
    const list = readFanSpeedList(raw?.attributes);
    const speed = cleanMode === 'eco' ? pickEcoFanSpeed(list) : pickStandardFanSpeed(list);
    if (raw && cleanMode === 'eco' && !speed) return { error: tv('noFanSpeeds') };

    const startSequence: unknown[] = [];
    if (speed) {
      startSequence.push({
        action: 'vacuum.set_fan_speed',
        target,
        data: { fan_speed: speed },
        continue_on_error: true,
      });
    }
    startSequence.push({ action: 'vacuum.start', target });

    const trigger: unknown[] = [{ trigger: 'time', at: `${startTime}:00`, id: 'start' }];
    const choose: unknown[] = [
      { conditions: [{ condition: 'trigger', id: 'start' }], sequence: startSequence },
    ];

    if (endTime) {
      trigger.push({ trigger: 'time', at: `${endTime}:00`, id: 'end' });
      choose.push({
        conditions: [{ condition: 'trigger', id: 'end' }],
        sequence: [
          // Si ya acabó y está en la base, no hay que molestarlo.
          {
            condition: 'not',
            conditions: [{ condition: 'state', entity_id: device.haEntityId, state: 'docked' }],
          },
          { action: 'vacuum.return_to_base', target },
        ],
      });
    }

    const dayLabel = days.map((d) => DAY_LABELS_ES[d]).join('/');
    const ok = await createHaAutomation(id, {
      alias: `Avyra: ${device.name} - ${dayLabel} ${startTime}${endTime ? `-${endTime}` : ''}`,
      description: 'Gestionado por Avyra — no editar manualmente',
      mode: 'single',
      trigger,
      condition: [{ condition: 'time', weekday: days.map((d) => HA_DAYS[d]) }],
      action: [{ choose }],
    });
    if (ok) haAutomationId = id;
  }

  try {
    const db = getDb();
    await db.insert(vacuumSchedules).values({
      id,
      deviceId,
      daysOfWeek: days,
      startTime,
      endTime,
      cleanMode,
      haAutomationId,
      enabled: true,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('[addVacuumSchedule] DB error:', err);
    // Sin fila no habría forma de borrarla desde Avyra: se deshace en HA.
    if (haAutomationId) await deleteHaAutomation(haAutomationId);
    return { error: tv('scheduleSaveError') };
  }

  return {
    schedule: { id, daysOfWeek: days, startTime, endTime, cleanMode, haAutomationId, enabled: true },
  };
}

export async function deleteVacuumSchedule(scheduleId: string): Promise<{ error?: string }> {
  const tc = await getTranslations('common');
  const tv = await getTranslations('vacuum');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const db = getDb();
  const [row] = await db
    .select({ haAutomationId: vacuumSchedules.haAutomationId })
    .from(vacuumSchedules)
    .innerJoin(devices, eq(devices.id, vacuumSchedules.deviceId))
    .where(and(eq(vacuumSchedules.id, scheduleId), eq(devices.householdId, householdId)))
    .limit(1);

  if (!row) return { error: tv('scheduleNotFound') };

  if (row.haAutomationId) await deleteHaAutomation(row.haAutomationId);
  await db.delete(vacuumSchedules).where(eq(vacuumSchedules.id, scheduleId));

  return {};
}
