/**
 * GET /api/cameras/[id]/tablet-recording/[recId]
 *
 * Proxies an MP4 recording from the Avyra APK tablet
 * (http://tablet-ip:8080/api/recordings/{recId}/stream) through Avyra.
 *
 * Needed because the tablet IP is on the local LAN and is not
 * directly reachable by the browser (which connects via Cloudflare tunnel).
 *
 * Supports Range requests so the browser can seek within the video.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { getDb, cameras, devices } from '@pradomotica/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id, recId } = await params;
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Only allow positive integers
  if (!/^\d+$/.test(recId)) {
    return new NextResponse('Invalid recording ID', { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .select({ rtspUrlEnc: cameras.rtspUrlEnc, enabled: devices.enabled })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  if (!row || !row.enabled || !row.rtspUrlEnc) {
    return new NextResponse('Not found', { status: 404 });
  }

  let rtspUrl: string;
  try {
    rtspUrl = decrypt(row.rtspUrlEnc);
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  let streamUrl: string;
  let authHeader: string;
  try {
    const parsed = new URL(rtspUrl);
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const base = `http://${parsed.hostname}:${parsed.port}`;
    streamUrl = `${base}/api/recordings/${recId}/stream`;
    authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  const upstreamHeaders: Record<string, string> = {
    Authorization: authHeader,
  };
  const rangeHeader = req.headers.get('range');
  if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

  try {
    const upstream = await fetch(streamUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new NextResponse('Recording not found', { status: upstream.status });
    }

    const responseHeaders = new Headers();
    responseHeaders.set(
      'Content-Type',
      upstream.headers.get('Content-Type') ?? 'video/mp4',
    );
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    const contentRange = upstream.headers.get('Content-Range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);
    // Solo anunciar soporte de Range si el upstream realmente respondió a él
    // (206) o lo declara. Anunciarlo cuando no se honra hace que el navegador
    // pida rangos y reciba el fichero entero desde el inicio → seek roto.
    const upstreamAcceptRanges = upstream.headers.get('Accept-Ranges');
    if (upstream.status === 206 || upstreamAcceptRanges === 'bytes') {
      responseHeaders.set('Accept-Ranges', 'bytes');
    } else {
      responseHeaders.set('Accept-Ranges', 'none');
    }
    responseHeaders.set('Cache-Control', 'private, max-age=3600');

    // Descarga al dispositivo: forzar attachment con nombre legible.
    if (req.nextUrl.searchParams.get('dl') === '1') {
      const rawName = req.nextUrl.searchParams.get('name') || `recording-${recId}.mp4`;
      const ascii = rawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      const encoded = encodeURIComponent(rawName);
      responseHeaders.set(
        'Content-Disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      );
    }

    return new NextResponse(upstream.body, {
      status: upstream.status, // 200 or 206 for range requests
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse('Camera unavailable', { status: 502 });
  }
}
