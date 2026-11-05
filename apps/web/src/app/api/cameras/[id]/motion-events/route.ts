/**
 * GET /api/cameras/[id]/motion-events?date=YYYYMMDD
 * DELETE /api/cameras/[id]/motion-events?eventId=XXX
 *
 * Lista los eventos de movimiento almacenados en la BD para esta cámara.
 * Usado por el modal de cámara para cámaras sin SD yi-hack (p.ej. tablet).
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gte, lt } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { getDb, devices, cameras, cameraMotionEvents } from '@pradomotica/db';

export interface MotionEventEntry {
  id: string;
  occurredAt: string; // ISO 8601
  type: 'motion' | 'sound';
  clipUrl?: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const dateParam =
    req.nextUrl.searchParams.get('date') ??
    new Date().toISOString().slice(0, 10).replace(/-/g, '');

  if (!/^\d{8}$/.test(dateParam)) {
    return new NextResponse('Invalid date', { status: 400 });
  }

  // Parse YYYYMMDD → start of day / end of day in UTC
  const year = parseInt(dateParam.slice(0, 4), 10);
  const month = parseInt(dateParam.slice(4, 6), 10) - 1;
  const day = parseInt(dateParam.slice(6, 8), 10);
  const dayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const dayEnd   = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));

  const db = getDb();

  // Check camera exists and is enabled
  const [cam] = await db
    .select({ enabled: devices.enabled })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  if (!cam || !cam.enabled) {
    return new NextResponse('Not found', { status: 404 });
  }

  const rows = await db
    .select({
      id: cameraMotionEvents.id,
      occurredAt: cameraMotionEvents.occurredAt,
      type: cameraMotionEvents.type,
      clipUrl: cameraMotionEvents.clipUrl,
    })
    .from(cameraMotionEvents)
    .where(
      and(
        eq(cameraMotionEvents.deviceId, id),
        gte(cameraMotionEvents.occurredAt, dayStart),
        lt(cameraMotionEvents.occurredAt, dayEnd),
      ),
    )
    .orderBy(cameraMotionEvents.occurredAt);

  const events: MotionEventEntry[] = rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    type: r.type as 'motion' | 'sound',
    clipUrl: r.clipUrl || undefined,
  }));

  return NextResponse.json({ events });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id: deviceId } = await params;
  if (!(await verifyCameraAccess(deviceId, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }
  const eventId = req.nextUrl.searchParams.get('eventId');
  if (!eventId) return new NextResponse('Missing eventId', { status: 400 });

  const db = getDb();

  await db
    .delete(cameraMotionEvents)
    .where(
      and(
        eq(cameraMotionEvents.id, eventId),
        eq(cameraMotionEvents.deviceId, deviceId),
      ),
    );

  return new NextResponse(null, { status: 204 });
}
