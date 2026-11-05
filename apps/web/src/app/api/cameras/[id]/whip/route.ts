/**
 * Proxy WHIP ingest hacia go2rtc.
 *
 * POST /api/cameras/[id]/whip
 *   Body: SDP offer (application/sdp)
 *   Response: SDP answer (application/sdp)
 *
 * El dispositivo (tablet) captura cámara+micro con getUserMedia y envía
 * el stream a go2rtc como producer vía WebRTC ingest (WHIP).
 * go2rtc luego sirve el stream a los viewers igual que cualquier otra cámara.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { env } from '@/lib/env';
import { getDb, cameras, devices, tabletAgents } from '@pradomotica/db';

function verifyToken(token: string, storedHash: string): boolean {
  const computed = createHash('sha256').update(token).digest('hex');
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
}

/** Crea un stream vacío en go2rtc si no existe (necesario para WHIP ingest). */
async function ensureEmptyStream(streamId: string): Promise<boolean> {
  try {
    const listRes = await fetch(`${env.GO2RTC_URL}/api/streams`, {
      signal: AbortSignal.timeout(3000),
    });
    if (listRes.ok) {
      const streams: Record<string, unknown> = await listRes.json();
      if (streamId in streams) return true;
    }

    // Crear stream vacío con PUT sin src
    const res = await fetch(
      `${env.GO2RTC_URL}/api/streams?name=${encodeURIComponent(streamId)}`,
      { method: 'PUT', signal: AbortSignal.timeout(5000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  // Accept both APK Bearer token auth and browser session auth.
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (bearerToken) {
    // APK authentication: verify token against tabletAgents.tokenHash
    const [agent] = await db
      .select({ tokenHash: tabletAgents.tokenHash })
      .from(tabletAgents)
      .where(eq(tabletAgents.deviceId, id))
      .limit(1);
    if (!agent?.tokenHash || !verifyToken(bearerToken, agent.tokenHash)) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  } else {
    // Browser session authentication
    const session = await auth();
    if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });
    if (!(await verifyCameraAccess(id, session.user.id))) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  const [row] = await db
    .select({
      go2rtcStreamId: cameras.go2rtcStreamId,
      enabled: devices.enabled,
    })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  if (!row || !row.enabled) {
    return new NextResponse('Not found', { status: 404 });
  }

  const streamId = row.go2rtcStreamId ?? id;

  const ready = await ensureEmptyStream(streamId);
  if (!ready) {
    return new NextResponse('GO2RTC_UNAVAILABLE', { status: 503 });
  }

  let offer: string;
  try {
    offer = await req.text();
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }

  // Proxy al endpoint WHIP ingest de go2rtc: dst= (no src=)
  try {
    const go2rtcRes = await fetch(
      `${env.GO2RTC_URL}/api/webrtc?dst=${encodeURIComponent(streamId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer,
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (go2rtcRes.ok) {
      const answer = await go2rtcRes.text();
      // WHIP spec: 201 Created. APK's WhipClient expects HttpStatusCode.Created.
      return new NextResponse(answer, {
        status: 201,
        headers: { 'Content-Type': 'application/sdp' },
      });
    }

    const body = await go2rtcRes.text().catch(() => '');
    console.error(`[whip] go2rtc returned ${go2rtcRes.status}: ${body}`);
    return new NextResponse(body || 'WHIP error', { status: go2rtcRes.status });
  } catch (e) {
    console.error('[whip] fetch to go2rtc failed:', e);
    return new NextResponse('GO2RTC_UNAVAILABLE', { status: 503 });
  }
}
