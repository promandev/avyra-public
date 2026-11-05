/**
 * GET /api/cameras/[id]/motion-poll
 *
 * Polls the camera's /sensors.json (IP Webcam API), saves new motion/sound
 * trigger events to the DB, and returns the current active state plus any
 * newly inserted events.
 *
 * The client (camera modal) calls this every ~5 s while the camera has no SD
 * recordings, to get live motion detection events without a push callback.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, and } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { newId } from '@/lib/id';
import { getDb, devices, cameras, cameraMotionEvents, householdMembers } from '@pradomotica/db';

export const dynamic = 'force-dynamic';

interface SensorData {
  unit: string;
  // Each entry: [tsMs, [value], clipUrl?]
  // The APK (v1.0.4+) adds a 3rd element with the proxied clip URL.
  data: [number, number[], string?][];
}

interface SensorsResponse {
  motion_event?: SensorData;
  sound_event?: SensorData;
  motion_active?: SensorData;
}

export interface MotionPollResult {
  motionActive: boolean;
  soundActive: boolean;
  newEvents: { occurredAt: string; type: 'motion' | 'sound'; clipUrl?: string }[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return NextResponse.json<MotionPollResult>({ motionActive: false, soundActive: false, newEvents: [] });
  }

  const db = getDb();

  // Verify user has access to this device's household
  const [row] = await db
    .select({ rtspUrlEnc: cameras.rtspUrlEnc, enabled: devices.enabled, householdId: devices.householdId })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  if (!row || !row.enabled || !row.rtspUrlEnc) {
    return NextResponse.json<MotionPollResult>({ motionActive: false, soundActive: false, newEvents: [] });
  }

  const [membership] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, row.householdId), eq(householdMembers.userId, session.user.id)))
    .limit(1);
  if (!membership) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let rtspUrl: string;
  try {
    rtspUrl = decrypt(row.rtspUrlEnc);
  } catch {
    return NextResponse.json<MotionPollResult>({ motionActive: false, soundActive: false, newEvents: [] });
  }

  let sensorsUrl: string;
  let username: string;
  let password: string;
  try {
    const parsed = new URL(rtspUrl);
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    sensorsUrl = `http://${parsed.hostname}:${parsed.port}/sensors.json`;
  } catch {
    return NextResponse.json<MotionPollResult>({ motionActive: false, soundActive: false, newEvents: [] });
  }

  // Fetch /sensors.json from the camera
  let sensors: SensorsResponse;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const cred = Buffer.from(`${username}:${password}`).toString('base64');
    const res = await fetch(sensorsUrl, {
      headers: { Authorization: `Basic ${cred}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return NextResponse.json<MotionPollResult>({ motionActive: false, soundActive: false, newEvents: [] });
    }
    sensors = (await res.json()) as SensorsResponse;
  } catch {
    return NextResponse.json<MotionPollResult>({ motionActive: false, soundActive: false, newEvents: [] });
  }

  // Find the most recent recorded event to avoid duplicates
  const [lastEvent] = await db
    .select({ occurredAt: cameraMotionEvents.occurredAt })
    .from(cameraMotionEvents)
    .where(eq(cameraMotionEvents.deviceId, id))
    .orderBy(desc(cameraMotionEvents.occurredAt))
    .limit(1);

  const lastMs = lastEvent ? lastEvent.occurredAt.getTime() : 0;

  // Collect trigger events (value === 1) newer than the last DB entry.
  // The APK encodes each entry as [tsMs, [1], clipUrl?] where clipUrl is
  // a direct tablet URL; we rewrite it to an Avyra proxy URL so the browser
  // can reach it through the server (LAN-only tablet IP not directly accessible).
  const toInsert: { id: string; deviceId: string; occurredAt: Date; type: string; clipUrl: string }[] = [];

  const sensorFields = [
    { type: 'motion', field: 'motion_event' },
    { type: 'sound', field: 'sound_event' },
  ] as const;

  for (const { type, field } of sensorFields) {
    const sensorData = sensors[field];
    if (!sensorData?.data) continue;
    for (const entry of sensorData.data) {
      const [tsMs, vals, rawClipUrl] = entry;
      if (vals[0] === 1 && tsMs > lastMs) {
        // Rewrite tablet clip URL to Avyra proxy URL
        let clipUrl = '';
        if (rawClipUrl) {
          try {
            const filename = new URL(rawClipUrl).pathname.split('/').at(-1) ?? '';
            if (filename) clipUrl = `/api/cameras/${id}/clip?file=${encodeURIComponent(filename)}`;
          } catch {
            // ignore malformed URL
          }
        }
        toInsert.push({
          id: newId(),
          deviceId: id,
          occurredAt: new Date(tsMs),
          type,
          clipUrl,
        });
      }
    }
  }

  if (toInsert.length > 0) {
    await db.insert(cameraMotionEvents).values(toInsert);
  }

  // Determine current active state from the most recent sensor reading
  const motionLastVal = sensors.motion_active?.data?.at(-1)?.[1]?.[0];
  const soundLastVal = sensors.sound_event?.data?.at(-1)?.[1]?.[0];

  return NextResponse.json<MotionPollResult>({
    motionActive: motionLastVal === 1,
    soundActive: soundLastVal === 1,
    newEvents: toInsert.map((e) => ({
      occurredAt: e.occurredAt.toISOString(),
      type: e.type as 'motion' | 'sound',
      clipUrl: e.clipUrl || undefined,
    })),
  });
}
