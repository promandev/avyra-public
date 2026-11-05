'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, requireRole } from '@/lib/household';
import { callHaService } from '@/lib/ha';
import { suppressDeviceAlerts } from '@/lib/device-alerts';
import { getDb, devices, lights } from '@pradomotica/db';

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

export type AddLightState = { error?: string; success?: boolean };

export async function addLight(
  _prev: AddLightState,
  formData: FormData,
): Promise<AddLightState> {
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
      type: 'light',
      name: data.name,
      haEntityId: data.haEntityId ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(lights).values({
      deviceId,
      model: data.model ?? null,
    });
  });

  revalidatePath('/dashboard/lights');
  return { success: true };
}

export async function deleteLight(deviceId: string): Promise<void> {
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
  revalidatePath('/dashboard/lights');
}

export type EditLightState = { error?: string; success?: boolean };

const editSchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().max(80).optional(),
  haEntityId: z.string().max(200).optional().or(z.literal('')),
});

export async function editLight(
  deviceId: string,
  _prev: EditLightState,
  formData: FormData,
): Promise<EditLightState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

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
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ name: data.name, haEntityId: data.haEntityId ?? null, updatedAt: now })
      .where(eq(devices.id, deviceId));
    await tx
      .update(lights)
      .set({ model: data.model ?? null })
      .where(eq(lights.deviceId, deviceId));
  });

  revalidatePath('/dashboard/lights');
  return { success: true };
}

export type ToggleLightResult = { error?: string };

export async function toggleLight(deviceId: string): Promise<ToggleLightResult> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const db = getDb();
  const [device] = await db
    .select({ haEntityId: devices.haEntityId })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);

  if (!device) return { error: tc('notFound') };

  const t = await getTranslations('lights');
  if (!device.haEntityId) return { error: t('noHaEntity') };

  // Lo que se manda desde la app no vuelve como notificación push.
  suppressDeviceAlerts(deviceId);

  // Use the entity's own domain (e.g. switch/toggle) which is always valid.
  // homeassistant/toggle also works but some HA versions are stricter.
  const [domain] = device.haEntityId.split('.') as [string];
  try {
    await callHaService(domain, 'toggle', device.haEntityId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `${t('toggleError')}: ${detail}` };
  }

  revalidatePath('/dashboard/lights');
  return {};
}
