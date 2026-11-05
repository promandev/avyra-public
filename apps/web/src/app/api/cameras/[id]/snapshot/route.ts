import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { cameraProxyStream } from '@/lib/camera-fetch';
import { logCameraEvent } from '@/lib/camera-log';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { getDb, cameras, devices } from '@pradomotica/db';

// Tiempo máximo de fetch a la cámara
const CAMERA_TIMEOUT_MS = 8000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;
  // Las miniaturas se refrescan cada 5 s: logCameraEvent agrupa los repetidos.
  const logFail = (httpStatus: number, message: string) =>
    logCameraEvent({ deviceId: id, stage: 'snapshot', level: 'warn', httpStatus, message, userId, headers: req.headers });
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const db = getDb();
  const [row] = await db
    .select({
      snapshotUrlEnc: cameras.snapshotUrlEnc,
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

  // Fallback: si no hay snapshot URL directa, obtener frame de go2rtc
  // (útil para cámaras tipo tablet que pushean vía WHIP)
  if (!row.snapshotUrlEnc) {
    const streamId = row.go2rtcStreamId ?? id;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CAMERA_TIMEOUT_MS);
      const upstream = await fetch(
        `${env.GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(streamId)}`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      if (!upstream.ok) {
        logFail(502, `go2rtc no dio fotograma (HTTP ${upstream.status})`);
        return new NextResponse('Camera unavailable', { status: 502 });
      }
      const body = await upstream.arrayBuffer();
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      logFail(502, isAbort ? 'go2rtc tardó demasiado en dar un fotograma' : 'Error pidiendo fotograma a go2rtc');
      return new NextResponse(isAbort ? 'Camera timeout' : 'Camera error', {
        status: 502,
      });
    }
  }

  let snapshotUrl: string;
  try {
    snapshotUrl = decrypt(row.snapshotUrlEnc);
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  // Validar que la URL desencriptada es realmente una URL http/https
  let parsed: URL;
  try {
    parsed = new URL(snapshotUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return new NextResponse('Invalid URL', { status: 400 });
    }
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  try {
    const res = await cameraProxyStream(snapshotUrl, {
      timeoutMs: CAMERA_TIMEOUT_MS,
      contentType: 'image/jpeg',
    });
    if (!res.ok) {
      // cameraProxyStream: 504 = la cámara no respondió a tiempo, 502 = no se
      // pudo conectar (apagada, fuera de la wifi o con otra IP).
      logFail(
        502,
        res.status === 504
          ? 'La cámara no respondió a tiempo a la foto'
          : res.status === 502
            ? 'No se pudo conectar con la cámara (¿apagada o con otra IP?)'
            : `La cámara respondió HTTP ${res.status} a la foto`,
      );
      return new NextResponse('Camera unavailable', { status: 502 });
    }
    // Override cache header for snapshots — always fresh
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  } catch {
    logFail(502, 'Error inesperado pidiendo la foto a la cámara');
    return new NextResponse('Camera error', { status: 502 });
  }
}
