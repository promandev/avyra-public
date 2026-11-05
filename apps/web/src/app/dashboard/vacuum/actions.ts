'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, requireRole } from '@/lib/household';
import { callHaService, getRawEntityState } from '@/lib/ha';
import { suppressDeviceAlerts } from '@/lib/device-alerts';
import { newId } from '@/lib/id';
import {
  DIRECTION_COMMANDS,
  VACUUM_CLEAN_MODES,
  pickEcoFanSpeed,
  pickStandardFanSpeed,
  readFanSpeedList,
  type VacuumCleanMode,
  type VacuumDirection,
} from '@/lib/vacuum';
import { getDb, devices, vacuums } from '@pradomotica/db';

const PATH = '/dashboard/vacuum';
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

// ---------- Alta, edición y borrado ------------------------------------------

export type VacuumFormState = { error?: string; success?: boolean };

async function parseVacuumForm(formData: FormData) {
  const tc = await getTranslations('common');
  const tv = await getTranslations('vacuum');

  const entity = z
    .string()
    .trim()
    .max(200)
    .regex(ENTITY_ID, tv('invalidEntity'))
    .optional();

  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    model: z.string().trim().max(80).optional(),
    haEntityId: entity.refine((v) => !v || v.startsWith('vacuum.'), tv('invalidVacuumEntity')),
    waterTankEntityId: entity,
    batteryEntityId: entity,
    cleanTimeEntityId: entity,
    cleanAreaEntityId: entity,
  });

  const field = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };

  const parsed = schema.safeParse({
    name: formData.get('name'),
    model: field('model'),
    haEntityId: field('haEntityId'),
    waterTankEntityId: field('waterTankEntityId'),
    batteryEntityId: field('batteryEntityId'),
    cleanTimeEntityId: field('cleanTimeEntityId'),
    cleanAreaEntityId: field('cleanAreaEntityId'),
  });

  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? tc('invalidData') } as const;
  }
  return { data: parsed.data } as const;
}

export async function addVacuum(
  _prev: VacuumFormState,
  formData: FormData,
): Promise<VacuumFormState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const parsed = await parseVacuumForm(formData);
  if ('error' in parsed) return { error: parsed.error };
  const data = parsed.data;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const db = getDb();
  const deviceId = newId();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(devices).values({
      id: deviceId,
      householdId,
      type: 'vacuum',
      name: data.name,
      haEntityId: data.haEntityId ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(vacuums).values({
      deviceId,
      model: data.model ?? null,
      waterTankEntityId: data.waterTankEntityId ?? null,
      batteryEntityId: data.batteryEntityId ?? null,
      cleanTimeEntityId: data.cleanTimeEntityId ?? null,
      cleanAreaEntityId: data.cleanAreaEntityId ?? null,
    });
  });

  revalidatePath(PATH);
  return { success: true };
}

export async function editVacuum(
  deviceId: string,
  _prev: VacuumFormState,
  formData: FormData,
): Promise<VacuumFormState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const parsed = await parseVacuumForm(formData);
  if ('error' in parsed) return { error: parsed.error };
  const data = parsed.data;

  const db = getDb();
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .innerJoin(vacuums, eq(vacuums.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return { error: tc('notFound') };

  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ name: data.name, haEntityId: data.haEntityId ?? null, updatedAt: new Date() })
      .where(eq(devices.id, deviceId));
    await tx
      .update(vacuums)
      .set({
        model: data.model ?? null,
        waterTankEntityId: data.waterTankEntityId ?? null,
        batteryEntityId: data.batteryEntityId ?? null,
        cleanTimeEntityId: data.cleanTimeEntityId ?? null,
        cleanAreaEntityId: data.cleanAreaEntityId ?? null,
      })
      .where(eq(vacuums.deviceId, deviceId));
  });

  revalidatePath(PATH);
  return { success: true };
}

export async function deleteVacuum(deviceId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  if (!(await requireRole(session.user.id))) return;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return;

  const db = getDb();
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .innerJoin(vacuums, eq(vacuums.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return;

  await db.delete(devices).where(eq(devices.id, deviceId));
  revalidatePath(PATH);
}

// ---------- Control ----------------------------------------------------------
//
// Los argumentos de una server action llegan del navegador: los tipos de
// TypeScript no protegen nada, así que cada acción valida lo que recibe.

export type VacuumActionResult = { error?: string };

type SimpleCommand = 'start' | 'pause' | 'return_to_base' | 'locate';
const SIMPLE_COMMANDS: readonly SimpleCommand[] = ['start', 'pause', 'return_to_base', 'locate'];

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cualquier miembro del hogar puede manejar el robot, igual que el aire. */
async function resolveVacuumEntity(
  deviceId: string,
): Promise<{ entityId: string } | { error: string }> {
  const tc = await getTranslations('common');
  const tv = await getTranslations('vacuum');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const db = getDb();
  const [device] = await db
    .select({ haEntityId: devices.haEntityId })
    .from(devices)
    .innerJoin(vacuums, eq(vacuums.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);

  if (!device) return { error: tc('notFound') };
  if (!device.haEntityId) return { error: tv('noHaEntity') };
  return { entityId: device.haEntityId };
}

export async function runVacuumCommand(
  deviceId: string,
  command: SimpleCommand,
): Promise<VacuumActionResult> {
  const tc = await getTranslations('common');
  const tv = await getTranslations('vacuum');
  if (!SIMPLE_COMMANDS.includes(command)) return { error: tc('invalidData') };

  const target = await resolveVacuumEntity(deviceId);
  if ('error' in target) return target;

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  try {
    await callHaService('vacuum', command, target.entityId);
  } catch (err) {
    return { error: `${tv('commandError')}: ${describe(err)}` };
  }

  revalidatePath(PATH);
  return {};
}

/**
 * Auto y Eco son "limpia con esta potencia": fija la succión y arranca.
 * Si ya estaba limpiando sólo cambia la potencia, sin reiniciar el ciclo.
 */
export async function startVacuumInMode(
  deviceId: string,
  mode: VacuumCleanMode,
): Promise<VacuumActionResult> {
  const tc = await getTranslations('common');
  const tv = await getTranslations('vacuum');
  if (!VACUUM_CLEAN_MODES.includes(mode)) return { error: tc('invalidData') };

  const target = await resolveVacuumEntity(deviceId);
  if ('error' in target) return target;

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  const raw = await getRawEntityState(target.entityId);
  const list = readFanSpeedList(raw?.attributes);
  const speed = mode === 'eco' ? pickEcoFanSpeed(list) : pickStandardFanSpeed(list);
  if (mode === 'eco' && !speed) return { error: tv('noFanSpeeds') };

  try {
    if (speed && raw?.attributes?.fan_speed !== speed) {
      await callHaService('vacuum', 'set_fan_speed', target.entityId, { fan_speed: speed });
    }
    if (raw?.state !== 'cleaning') {
      await callHaService('vacuum', 'start', target.entityId);
    }
  } catch (err) {
    return { error: `${tv('commandError')}: ${describe(err)}` };
  }

  revalidatePath(PATH);
  return {};
}

export async function setVacuumFanSpeed(
  deviceId: string,
  fanSpeed: string,
): Promise<VacuumActionResult> {
  const tv = await getTranslations('vacuum');

  const target = await resolveVacuumEntity(deviceId);
  if ('error' in target) return target;

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  // Sólo se aceptan potencias que el propio robot anuncia.
  const raw = await getRawEntityState(target.entityId);
  if (typeof fanSpeed !== 'string' || !readFanSpeedList(raw?.attributes).includes(fanSpeed)) {
    return { error: tv('invalidFanSpeed') };
  }

  try {
    await callHaService('vacuum', 'set_fan_speed', target.entityId, { fan_speed: fanSpeed });
  } catch (err) {
    return { error: `${tv('fanSpeedError')}: ${describe(err)}` };
  }

  revalidatePath(PATH);
  return {};
}

/**
 * Nombre de orden que entiende cada robot, aprendido en la primera pulsación.
 *
 * Hace falta porque tuya-local ignora en silencio un nombre que su perfil no
 * conoce: la llamada responde 200 y no pasa nada. Verificado con la Conga 1090,
 * que acusa `left` e ignora `turn_left`. Por eso no basta con encadenar
 * candidatos hasta que uno no falle; hay que releer la entidad y ver si el robot
 * acusó recibo. Como esa comprobación cuesta casi un segundo, sólo se paga una
 * vez por robot y dirección. El mapa vive en memoria: si el proceso se reinicia,
 * vuelve a aprenderse.
 */
const learnedDirectionCommand = new Map<string, string>();
/** Margen para que el robot confirme la orden por la red local. */
const DIRECTION_ACK_MS = 900;

/**
 * Control manual. El robot sigue moviéndose hasta recibir `stop`, así que la
 * interfaz manda la dirección al pulsar y `stop` al soltar.
 */
export async function driveVacuum(
  deviceId: string,
  direction: VacuumDirection,
): Promise<VacuumActionResult> {
  const tc = await getTranslations('common');
  const tv = await getTranslations('vacuum');
  if (!Object.hasOwn(DIRECTION_COMMANDS, direction)) return { error: tc('invalidData') };

  const target = await resolveVacuumEntity(deviceId);
  if ('error' in target) return target;

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  const key = `${target.entityId}:${direction}`;
  const learned = learnedDirectionCommand.get(key);
  const candidates = learned ? [learned] : DIRECTION_COMMANDS[direction];

  let lastError: unknown = null;
  for (const command of candidates) {
    try {
      await callHaService('vacuum', 'send_command', target.entityId, { command });
    } catch (err) {
      lastError = err;
      continue;
    }

    // `stop` no se verifica: es el mismo nombre en todos los perfiles y tiene
    // que salir cuanto antes, que es lo que detiene al robot al soltar.
    if (learned || direction === 'stop') {
      learnedDirectionCommand.set(key, command);
      return {};
    }

    await new Promise((resolve) => setTimeout(resolve, DIRECTION_ACK_MS));
    const confirmed = await getRawEntityState(target.entityId);
    if (confirmed?.attributes?.direction_control === command) {
      learnedDirectionCommand.set(key, command);
      return {};
    }
  }

  return { error: lastError ? `${tv('driveError')}: ${describe(lastError)}` : tv('driveRejected') };
}
