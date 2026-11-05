'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, requireRole } from '@/lib/household';
import { callHaService, getRawEntityState } from '@/lib/ha';
import { suppressDeviceAlerts } from '@/lib/device-alerts';
import { getDb, devices, acUnits } from '@pradomotica/db';

const schema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().max(80).optional(),
  haEntityId: z.string().max(200).optional().or(z.literal('')),
});

function newId() {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

export type AddAcState = { error?: string; success?: boolean };

export async function addAc(
  _prev: AddAcState,
  formData: FormData,
): Promise<AddAcState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const raw = {
    name: formData.get('name'),
    model: formData.get('model') || undefined,
    haEntityId: formData.get('haEntityId') || undefined,
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
      type: 'ac',
      name: data.name,
      haEntityId: data.haEntityId ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(acUnits).values({
      deviceId,
      model: data.model ?? null,
    });
  });

  revalidatePath('/dashboard/ac');
  return { success: true };
}

export async function deleteAc(deviceId: string): Promise<void> {
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
  revalidatePath('/dashboard/ac');
}

export type EditAcState = { error?: string; success?: boolean };

const editSchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().max(80).optional(),
  haEntityId: z.string().max(200).optional().or(z.literal('')),
});

export async function editAc(
  deviceId: string,
  _prev: EditAcState,
  formData: FormData,
): Promise<EditAcState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const raw = {
    name: formData.get('name'),
    model: formData.get('model') || undefined,
    haEntityId: formData.get('haEntityId') || undefined,
  };

  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? tc('invalidData') };
  }
  const data = parsed.data;

  const db = getDb();

  // Verify device belongs to user's household
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return { error: tc('notFound') };

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ name: data.name, haEntityId: data.haEntityId ?? null, updatedAt: now })
      .where(eq(devices.id, deviceId));
    await tx
      .update(acUnits)
      .set({ model: data.model ?? null })
      .where(eq(acUnits.deviceId, deviceId));
  });

  revalidatePath('/dashboard/ac');
  return { success: true };
}

// ---------- Climate control actions ----------------------------------------

export type AcActionResult = {
  error?: string;
  confirmedTarget?: number | null;
  confirmedState?: string;
  confirmedFanMode?: string;
};

async function getAcEntity(
  deviceId: string,
  userId: string,
): Promise<{ haEntityId: string | null } | null> {
  const householdId = await getActiveHouseholdId(userId);
  if (!householdId) return null;

  const db = getDb();
  const [device] = await db
    .select({ haEntityId: devices.haEntityId })
    .from(devices)
    .innerJoin(acUnits, eq(acUnits.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);

  return device ?? null;
}

export async function toggleAc(deviceId: string): Promise<AcActionResult> {
  const tc = await getTranslations('common');
  const ta = await getTranslations('ac');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const device = await getAcEntity(deviceId, session.user.id);
  if (!device) return { error: tc('notFound') };
  if (!device.haEntityId) return { error: ta('noHaEntity') };

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  const domain = device.haEntityId.split('.')[0] || 'climate';
  try {
    const raw = await getRawEntityState(device.haEntityId);
    const isOff = raw?.state === 'off';

    if (domain === 'climate') {
      const modesRaw = raw?.attributes?.hvac_modes;
      const hvacModes = Array.isArray(modesRaw)
        ? modesRaw.filter((m): m is string => typeof m === 'string')
        : [];
      const onMode = hvacModes.find((m) => m === 'cool') ?? hvacModes.find((m) => m !== 'off') ?? 'cool';

      if (isOff) {
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
      const service = isOff ? 'turn_on' : 'turn_off';
      await callHaService(domain, service, device.haEntityId);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `${ta('toggleError')}: ${detail}` };
  }

  const confirmed = await getRawEntityState(device.haEntityId);
  revalidatePath('/dashboard/ac');
  return { confirmedState: confirmed?.state ?? undefined };
}

export async function setAcTargetTemperature(
  deviceId: string,
  targetTemperature: number,
): Promise<AcActionResult> {
  const tc = await getTranslations('common');
  const ta = await getTranslations('ac');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  if (!Number.isFinite(targetTemperature) || targetTemperature < 10 || targetTemperature > 35) {
    return { error: tc('invalidData') };
  }

  const device = await getAcEntity(deviceId, session.user.id);
  if (!device) return { error: tc('notFound') };
  if (!device.haEntityId) return { error: ta('noHaEntity') };

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  try {
    await callHaService('climate', 'set_temperature', device.haEntityId, {
      temperature: targetTemperature,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `${ta('setTempError')}: ${detail}` };
  }

  const confirmed = await getRawEntityState(device.haEntityId);
  const rawTarget = confirmed?.attributes?.temperature;
  const confirmedTarget = typeof rawTarget === 'number' ? rawTarget : null;

  revalidatePath('/dashboard/ac');
  return { confirmedTarget };
}

export async function setAcFanMode(
  deviceId: string,
  fanMode: string,
): Promise<AcActionResult> {
  const tc = await getTranslations('common');
  const ta = await getTranslations('ac');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const device = await getAcEntity(deviceId, session.user.id);
  if (!device) return { error: tc('notFound') };
  if (!device.haEntityId) return { error: ta('noHaEntity') };

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  try {
    await callHaService('climate', 'set_fan_mode', device.haEntityId, {
      fan_mode: fanMode,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `${ta('setFanError')}: ${detail}` };
  }

  const confirmed = await getRawEntityState(device.haEntityId);
  const confirmedFanMode = typeof confirmed?.attributes?.fan_mode === 'string'
    ? confirmed.attributes.fan_mode
    : undefined;

  revalidatePath('/dashboard/ac');
  return { confirmedFanMode };
}
