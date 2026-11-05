/**
 * Proxy de señalización WebRTC hacia go2rtc.
 *
 * POST /api/cameras/[id]/webrtc
 *   Body: SDP offer (text/plain)
 *   Response: SDP answer (text/plain)
 *
 * El cliente (browser) usa RTCPeerConnection nativo — sin hls.js.
 * go2rtc gestiona la conversión RTSP → WebRTC internamente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { logCameraEvent } from '@/lib/camera-log';
import { buildGo2rtcSource } from '@/lib/go2rtc-source';
import { getDb, cameras, devices } from '@pradomotica/db';

/**
 * Re-encodes URL credentials so special chars (like @ in passwords) are
 * properly percent-encoded for go2rtc/ffmpeg. Works for any URL scheme
 * (rtsp://, onvif://, http://, etc.).
 */
/**
 * The URL stored in the DB was validated by Zod's .url() (which uses new URL()
 * internally) before being encrypted. The decrypted value is therefore already
 * a well-formed URL with percent-encoded credentials (e.g. @ → %40).
 * We only need to rebuild the URL without the userinfo when the scheme is one
 * that doesn't carry credentials natively (none currently), so just return as-is.
 */
function normalizeUrlCredentials(rawUrl: string): string {
  return rawUrl;
}

async function ensureStream(streamId: string, rtspUrl: string): Promise<boolean> {
  // Siempre hacemos PUT para garantizar que el source URL es el correcto.
  // buildGo2rtcSource (compartida con el proxy HLS) selecciona el tipo de
  // fuente adecuado según el esquema URL.
  const src = buildGo2rtcSource(normalizeUrlCredentials(rtspUrl));

  try {
    const putRes = await fetch(
      `${env.GO2RTC_URL}/api/streams?src=${encodeURIComponent(src)}&name=${encodeURIComponent(streamId)}`,
      { method: 'PUT', signal: AbortSignal.timeout(5000) },
    );
    return putRes.ok;
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }
  const db = getDb();

  let row: { rtspUrlEnc: string | null; go2rtcStreamId: string | null; enabled: boolean } | undefined;
  try {
    [row] = await db
      .select({
        rtspUrlEnc: cameras.rtspUrlEnc,
        go2rtcStreamId: cameras.go2rtcStreamId,
        enabled: devices.enabled,
      })
      .from(cameras)
      .innerJoin(devices, eq(cameras.deviceId, devices.id))
      .where(eq(cameras.deviceId, id))
      .limit(1);
  } catch (e) {
    console.error('[webrtc] DB query error:', e);
    return new NextResponse('DB error', { status: 500 });
  }

  if (!row || !row.enabled) return new NextResponse('Not found', { status: 404 });

  const streamId = row.go2rtcStreamId ?? id;

  // Cámaras con RTSP: registrar stream en go2rtc y forzar conexión lazy.
  // Cámaras push (tablet): el stream ya existe y tiene un producer activo
  // desde el dispositivo que pushea vía WHIP; solo necesitamos asegurar
  // que el stream vacío exista en go2rtc.
  if (row.rtspUrlEnc) {
    let rtspUrl: string;
    try {
      rtspUrl = decrypt(row.rtspUrlEnc);
    } catch (e) {
      console.error('[webrtc] decrypt error for camera', id, ':', e);
      return new NextResponse('Internal error', { status: 500 });
    }

    const registered = await ensureStream(streamId, rtspUrl);
    if (!registered) {
      logCameraEvent({
        deviceId: id,
        stage: 'webrtc',
        httpStatus: 503,
        message: 'go2rtc no responde al registrar el stream',
        userId: session.user.id,
        headers: req.headers,
      });
      return new NextResponse('GO2RTC_UNAVAILABLE', { status: 503 });
    }

    // El producer arranca de forma lazy con la propia negociación WebRTC de
    // abajo (go2rtc lo inicia al añadir el consumer; el bucle reintenta 15 s).
    // NO usar stream.mp4 como "kick": cancelar su body hace que go2rtc escriba
    // sobre la conexión cerrada y muera con SIGSEGV (panic en WriteBuffer.Flush).
  } else {
    // Push-based stream (tablet WHIP): verificar que el stream existe y tiene
    // un producer activo (la tablet debe estar emitiendo).
    try {
      const listRes = await fetch(`${env.GO2RTC_URL}/api/streams`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!listRes.ok) {
        return new NextResponse('GO2RTC_UNAVAILABLE', { status: 503 });
      }
      const streams: Record<string, unknown> = await listRes.json();
      if (!(streamId in streams)) {
        // Stream no existe todavía: crearlo vacío
        await fetch(
          `${env.GO2RTC_URL}/api/streams?name=${encodeURIComponent(streamId)}`,
          { method: 'PUT', signal: AbortSignal.timeout(5000) },
        ).catch(() => undefined);
        // Sin producer activo → tablet no está emitiendo
        return new NextResponse('NO_STREAM_ACTIVE', { status: 409 });
      }
      // Verificar si hay algún producer activo
      const streamData = streams[streamId];
      const hasProducer = Array.isArray(streamData)
        ? streamData.some((c: unknown) => {
            const conn = c as Record<string, unknown>;
            return conn.type === 'producer' || !('type' in conn);
          })
        : streamData !== null && streamData !== undefined;
      if (!hasProducer) {
        return new NextResponse('NO_STREAM_ACTIVE', { status: 409 });
      }
    } catch {
      return new NextResponse('GO2RTC_UNAVAILABLE', { status: 503 });
    }
  }

  let offer: string;
  try {
    offer = await req.text();
  } catch (e) {
    console.error('[webrtc] failed to read request body:', e);
    return new NextResponse('Bad request', { status: 400 });
  }

  // Reintentar hasta 15 veces (1 s entre intentos = 15 s de ventana).
  // El producer ffmpeg de go2rtc tarda ~9 s en arrancar para cámaras con
  // autenticación RTSP (IP Webcam, etc.), así que necesitamos paciencia.
  let lastStatus = 500;
  let lastBody = '';
  for (let attempt = 0; attempt < 15; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    try {
      const go2rtcRes = await fetch(
        `${env.GO2RTC_URL}/api/webrtc?src=${encodeURIComponent(streamId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offer,
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (go2rtcRes.ok) {
        const answer = await go2rtcRes.text();
        console.log(`[webrtc] answer OK para "${streamId}" (intento ${attempt + 1})`);
        return new NextResponse(answer, {
          status: 200,
          headers: { 'Content-Type': 'application/sdp' },
        });
      }

      lastStatus = go2rtcRes.status;
      lastBody = await go2rtcRes.text().catch(() => '');
      console.error(
        `[webrtc] go2rtc attempt ${attempt + 1}/15 → ${lastStatus} for stream "${streamId}": ${lastBody}`,
      );

      // Solo reintentar en 500 (producer no listo aún); otros errores son definitivos
      if (lastStatus !== 500) break;
    } catch (e) {
      console.error(`[webrtc] fetch to go2rtc failed (attempt ${attempt + 1}/15):`, e);
      logCameraEvent({
        deviceId: id,
        stage: 'webrtc',
        httpStatus: 503,
        message: `No se pudo negociar con go2rtc: ${e instanceof Error ? (e.name === 'TimeoutError' ? 'timeout' : e.message) : String(e)}`,
        userId: session.user.id,
        headers: req.headers,
        detail: { attempt: attempt + 1 },
      });
      return new NextResponse('GO2RTC_UNAVAILABLE', { status: 503 });
    }
  }

  logCameraEvent({
    deviceId: id,
    stage: 'webrtc',
    httpStatus: lastStatus,
    message: `go2rtc rechazó el WebRTC: ${lastBody.slice(0, 200) || 'sin detalle'}`,
    userId: session.user.id,
    headers: req.headers,
  });
  return new NextResponse(lastBody || 'go2rtc WebRTC error', { status: lastStatus });
}
