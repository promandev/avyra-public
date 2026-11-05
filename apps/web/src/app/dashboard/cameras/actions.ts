'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { ADMIN_EMAIL } from '@/lib/camera-access';
import { encrypt } from '@/lib/crypto';
import { getActiveHouseholdId } from '@/lib/household';
import { getDb, devices, cameras, tabletAgents } from '@pradomotica/db';

const getSchema = async () => {
  const t = await getTranslations('cameras');
  return z.object({
    name: z.string().min(1).max(80),
    model: z.string().max(80).optional(),
    // Snapshot URL is optional; when provided must be HTTP/HTTPS (not RTSP)
    snapshotUrl: z.union([
      z.string().url(t('invalidSnapshotUrl')).refine(
        (u) => u.startsWith('http://') || u.startsWith('https://'),
        { message: t('invalidSnapshotUrl') },
      ),
      z.literal(''),
    ]).optional(),
    rtspUrl: z.string().url(t('invalidRtspUrl')).optional().or(z.literal('')),
    go2rtcStreamId: z.string().max(100).optional().or(z.literal('')),
  });
};

function newId() {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

/** Derive the camera HTTP base URL (protocol + host) from the snapshot URL. */
function deriveBaseHttpUrl(snapshotUrl: string): string | null {
  try {
    const u = new URL(snapshotUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export type AddCameraState = { error?: string; success?: boolean };

export async function addCamera(
  _prev: AddCameraState,
  formData: FormData,
): Promise<AddCameraState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const raw = {
    name: formData.get('name'),
    model: formData.get('model') || undefined,
    snapshotUrl: formData.get('snapshotUrl'),
    rtspUrl: formData.get('rtspUrl') || undefined,
    go2rtcStreamId: formData.get('go2rtcStreamId') || undefined,
  };

  const schema = await getSchema();
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
      type: 'camera',
      name: data.name,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const sdBaseUrl = data.snapshotUrl ? deriveBaseHttpUrl(data.snapshotUrl) : null;
    await tx.insert(cameras).values({
      deviceId,
      model: data.model ?? null,
      snapshotUrlEnc: data.snapshotUrl ? encrypt(data.snapshotUrl) : null,
      rtspUrlEnc: data.rtspUrl ? encrypt(data.rtspUrl) : null,
      sdHttpUrlEnc: sdBaseUrl ? encrypt(sdBaseUrl) : null,
      go2rtcStreamId: data.go2rtcStreamId ?? null,
    });
  });

  revalidatePath('/dashboard/cameras');
  return { success: true };
}

export async function deleteCamera(deviceId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

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
  revalidatePath('/dashboard/cameras');
}

export type EditCameraState = { error?: string; success?: boolean };

export async function editCamera(
  deviceId: string,
  _prev: EditCameraState,
  formData: FormData,
): Promise<EditCameraState> {
  const tc = await getTranslations('common');
  const t = await getTranslations('cameras');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  const raw = {
    name: formData.get('name'),
    model: formData.get('model') || undefined,
    snapshotUrl: formData.get('snapshotUrl'),
    rtspUrl: formData.get('rtspUrl') || undefined,
    go2rtcStreamId: formData.get('go2rtcStreamId') || undefined,
  };

  const schema = await getSchema();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? tc('invalidData') };
  }
  const data = parsed.data;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const db = getDb();
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return { error: t('cameraNotFound') };

  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ name: data.name, updatedAt: new Date() })
      .where(eq(devices.id, deviceId));
    const sdBaseUrl = data.snapshotUrl ? deriveBaseHttpUrl(data.snapshotUrl) : null;
    await tx
      .update(cameras)
      .set({
        model: data.model ?? null,
        snapshotUrlEnc: data.snapshotUrl ? encrypt(data.snapshotUrl) : null,
        rtspUrlEnc: data.rtspUrl ? encrypt(data.rtspUrl) : null,
        sdHttpUrlEnc: sdBaseUrl ? encrypt(sdBaseUrl) : null,
        go2rtcStreamId: data.go2rtcStreamId ?? null,
      })
      .where(eq(cameras.deviceId, deviceId));
  });

  revalidatePath('/dashboard/cameras');
  return { success: true };
}

export async function updateCameraRtsp(
  deviceId: string,
  rtspUrl: string,
): Promise<{ error?: string }> {
  const tc = await getTranslations('common');
  const t = await getTranslations('cameras');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };

  let parsed: URL;
  try {
    parsed = new URL(rtspUrl);
    if (parsed.protocol !== 'rtsp:') return { error: t('rtspMustStartWith') };
  } catch {
    return { error: t('invalidRtspUrl') };
  }

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const db = getDb();
  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!device) return { error: t('cameraNotFound') };

  await db
    .update(cameras)
    .set({ rtspUrlEnc: encrypt(rtspUrl) })
    .where(eq(cameras.deviceId, deviceId));

  return {};
}

// ── Tablet camera ─────────────────────────────────────────────────────────────

export type AddTabletCameraState = { error?: string; success?: boolean; deviceId?: string };

const tabletSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function addTabletCamera(
  _prev: AddTabletCameraState,
  formData: FormData,
): Promise<AddTabletCameraState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  if (session.user.email !== ADMIN_EMAIL) return { error: tc('notAuthenticated') };

  const parsed = tabletSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? tc('invalidData') };
  }

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const db = getDb();
  const deviceId = newId();
  const now = new Date();
  // Stream ID legible: tablet-<random 6 chars>
  const streamId = `tablet-${deviceId.slice(0, 8)}`;

  await db.transaction(async (tx) => {
    await tx.insert(devices).values({
      id: deviceId,
      householdId,
      type: 'camera',
      name: parsed.data.name,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(cameras).values({
      deviceId,
      model: 'Tablet',
      snapshotUrlEnc: null,
      rtspUrlEnc: null,
      sdHttpUrlEnc: null,
      go2rtcStreamId: streamId,
    });

    const pairingSecret = randomBytes(32).toString('hex');
    await tx.insert(tabletAgents).values({
      deviceId,
      pairingSecretEnc: encrypt(pairingSecret),
      status: 'unpaired',
    });
  });

  revalidatePath('/dashboard/cameras');
  return { success: true, deviceId };
}

// ── Verificación de acceso a cámara especial ──────────────────────────────────

export async function verifyTabletAccess(
  username: string,
  password: string,
): Promise<{ ok: boolean }> {
  const { env } = await import('@/lib/env');
  const expectedUser = env.TABLET_ACCESS_USER ?? '';
  const expectedPass = env.TABLET_ACCESS_PASSWORD ?? '';
  if (!expectedUser || !expectedPass) return { ok: false };
  const ok = username === expectedUser && password === expectedPass;
  return { ok };
}
