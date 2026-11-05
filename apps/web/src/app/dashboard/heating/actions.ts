'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, requireRole } from '@/lib/household';
import { callHaService, getRawEntityState, HaServiceError } from '@/lib/ha';
import { suppressDeviceAlerts } from '@/lib/device-alerts';
import { syncScheduleAutomations } from '@/lib/thermostat-schedules';
import { getDb, devices, thermostats } from '@pradomotica/db';

const schema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().max(80).optional(),
  haEntityId: z.string().max(200).optional().or(z.literal('')),
  temperatureScale: z.coerce.number().min(0.01).max(100).default(1),
});

function newId() {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

export type AddThermostatState = { error?: string; success?: boolean };

export async function addThermostat(
  _prev: AddThermostatState,
  formData: FormData,
): Promise<AddThermostatState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const raw = {
    name: formData.get('name'),
    model: formData.get('model') || undefined,
    haEntityId: formData.get('haEntityId') || undefined,
    temperatureScale: formData.get('temperatureScale') || '1',
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? tc('invalidData') };
  }
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
      type: 'thermostat',
      name: data.name,
      haEntityId: data.haEntityId ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(thermostats).values({
      deviceId,
      model: data.model ?? null,
      temperatureScale: data.temperatureScale,
    });
  });

  revalidatePath('/dashboard/heating');
  return { success: true };
}

export async function deleteThermostat(deviceId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  if (!(await requireRole(session.user.id))) return;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return;

  const db = getDb();
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return;

  await db.delete(devices).where(eq(devices.id, deviceId));
  revalidatePath('/dashboard/heating');
}

export type EditThermostatState = { error?: string; success?: boolean };

const editSchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().max(80).optional(),
  haEntityId: z.string().max(200).optional().or(z.literal('')),
  temperatureScale: z.coerce.number().min(0.01).max(100).default(1),
});

export async function editThermostat(
  deviceId: string,
  _prev: EditThermostatState,
  formData: FormData,
): Promise<EditThermostatState> {
  const tc = await getTranslations('common');
  const th = await getTranslations('heating');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const raw = {
    name: formData.get('name'),
    model: formData.get('model') || undefined,
    haEntityId: formData.get('haEntityId') || undefined,
    temperatureScale: formData.get('temperatureScale') || '1',
  };

  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? tc('invalidData') };
  }
  const data = parsed.data;

  // El id llega del cliente: sólo se edita un termostato del hogar activo.
  if (!(await getThermostatEntity(deviceId, session.user.id))) return { error: tc('notFound') };

  const db = getDb();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ name: data.name, haEntityId: data.haEntityId ?? null, updatedAt: now })
      .where(eq(devices.id, deviceId));
    await tx
      .update(thermostats)
      .set({ model: data.model ?? null, temperatureScale: data.temperatureScale })
      .where(eq(thermostats.deviceId, deviceId));
  });

  // Siempre, no sólo si cambian entidad o escala: guardar también repara unas
  // rutinas que se hubieran quedado apuntando a otra entidad.
  const { failed } = await syncScheduleAutomations(deviceId);

  revalidatePath('/dashboard/heating');
  // Lo guardado, guardado está; el error deja el diálogo abierto para reintentar.
  if (failed > 0) return { error: th('scheduleSyncError') };
  return { success: true };
}

export type ThermostatActionResult = {
  error?: string;
  confirmedTarget?: number | null;
  confirmedState?: string;
};

async function getThermostatEntity(
  deviceId: string,
  userId: string,
): Promise<{ haEntityId: string | null; temperatureScale: number } | null> {
  const householdId = await getActiveHouseholdId(userId);
  if (!householdId) return null;

  const db = getDb();
  const [device] = await db
    .select({ haEntityId: devices.haEntityId, temperatureScale: thermostats.temperatureScale })
    .from(devices)
    .innerJoin(thermostats, eq(thermostats.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);

  return device ?? null;
}

/** Texto del error de una orden a HA, con un `prefix` que dice qué se intentaba. */
function haErrorMessage(err: unknown, prefix: string, deviceError: string): string {
  // El 500 es la integración del aparato fallando por dentro; "500 Internal
  // Server Error" no le dice a nadie que lo que hay que mirar es HA.
  if (err instanceof HaServiceError && err.status >= 500) return `${prefix}: ${deviceError}`;
  const detail = err instanceof Error ? err.message : String(err);
  return `${prefix}: ${detail}`;
}

/**
 * Enciende o apaga, según lo que pida la pantalla.
 *
 * No es un conmutador a propósito: decidir el sentido con el estado de HA
 * falla justo cuando ese estado está desfasado (una integración en la nube que
 * ha dejado de informar mantiene el último valor), y entonces "Encender"
 * mandaba apagar. La orden explícita es idempotente: repetirla no hace daño.
 */
export async function setThermostatPower(
  deviceId: string,
  on: boolean,
): Promise<ThermostatActionResult> {
  const tc = await getTranslations('common');
  const th = await getTranslations('heating');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const device = await getThermostatEntity(deviceId, session.user.id);
  if (!device) return { error: tc('notFound') };
  if (!device.haEntityId) return { error: th('noHaEntity') };

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  const domain = device.haEntityId.split('.')[0] || 'climate';
  try {
    if (domain === 'climate') {
      if (on) {
        const raw = await getRawEntityState(device.haEntityId);
        const modesRaw = raw?.attributes?.hvac_modes;
        const hvacModes = Array.isArray(modesRaw)
          ? modesRaw.filter((m): m is string => typeof m === 'string')
          : [];
        // 'heat' antes que nada: en los termostatos Tuya 'auto' es el programa
        // semanal interno del aparato, que sube y baja la consigna a sus horas
        // sin pasar por la app. Encender nunca debe activarlo.
        const onMode = hvacModes.includes('heat')
          ? 'heat'
          : (hvacModes.find((m) => m !== 'off' && m !== 'auto') ?? 'heat');

        try {
          await callHaService('climate', 'set_hvac_mode', device.haEntityId, { hvac_mode: onMode });
        } catch {
          await callHaService('climate', 'turn_on', device.haEntityId);
        }
      } else {
        try {
          await callHaService('climate', 'set_hvac_mode', device.haEntityId, { hvac_mode: 'off' });
        } catch {
          await callHaService('climate', 'turn_off', device.haEntityId);
        }
      }
    } else {
      await callHaService(domain, on ? 'turn_on' : 'turn_off', device.haEntityId);
    }
  } catch (err) {
    return { error: haErrorMessage(err, th('toggleError'), th('haDeviceError')) };
  }

  // Read back confirmed state from HA.
  const confirmed = await getRawEntityState(device.haEntityId);

  revalidatePath('/dashboard/heating');
  return { confirmedState: confirmed?.state ?? undefined };
}

export async function setThermostatTargetTemperature(
  deviceId: string,
  targetTemperature: number,
): Promise<ThermostatActionResult> {
  const tc = await getTranslations('common');
  const th = await getTranslations('heating');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  if (!Number.isFinite(targetTemperature) || targetTemperature < 1 || targetTemperature > 500) {
    return { error: tc('invalidData') };
  }

  const device = await getThermostatEntity(deviceId, session.user.id);
  if (!device) return { error: tc('notFound') };
  if (!device.haEntityId) return { error: th('noHaEntity') };

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  // Convert from user-visible units back to HA units using the device's scale factor.
  const scale = device.temperatureScale ?? 1;
  const haTemperature = Number((targetTemperature / scale).toFixed(1));

  try {
    await callHaService('climate', 'set_temperature', device.haEntityId, {
      temperature: haTemperature,
    });
  } catch (err) {
    return { error: haErrorMessage(err, th('setTempError'), th('haDeviceError')) };
  }

  // Read back confirmed target temperature from HA (in HA units → multiply by scale for display).
  const confirmed = await getRawEntityState(device.haEntityId);
  const rawTarget = confirmed?.attributes?.temperature;
  const confirmedTarget = typeof rawTarget === 'number' ? rawTarget * scale : null;

  revalidatePath('/dashboard/heating');
  return { confirmedTarget };
}
