/**
 * GET /api/cameras/[id]/ipwebcam-video?file=%2Fmodet%2Fmodet_....mp4
 *
 * Proxies a video file from the IP Webcam device, forwarding Range headers
 * so the browser can seek within the video.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { getDb, cameras, devices } from '@pradomotica/db';

export const dynamic = 'force-dynamic';

// Allow only safe paths: /dirname/filename.mp4 (no traversal)
const SAFE_PATH_RE = /^\/[a-z0-9_-]+\/[a-z0-9_\-.]+\.mp4$/i;

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

  const rawFile = req.nextUrl.searchParams.get('file');
  if (!rawFile) return new NextResponse('Missing file', { status: 400 });

  const filePath = decodeURIComponent(rawFile);
  if (!SAFE_PATH_RE.test(filePath)) {
    return new NextResponse('Invalid file path', { status: 400 });
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

  let videoUrl: string;
  let authHeader: string;
  try {
    const parsed = new URL(rtspUrl);
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const base = `http://${parsed.hostname}:${parsed.port}`;
    videoUrl = `${base}/v${filePath}`;
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
    const upstream = await fetch(videoUrl, {
      headers: upstreamHeaders,
    });

    const responseHeaders = new Headers();
    responseHeaders.set(
      'Content-Type',
      upstream.headers.get('Content-Type') ?? 'video/mp4',
    );
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    const contentRange = upstream.headers.get('Content-Range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'private, max-age=3600');

    // Descarga al dispositivo: forzar attachment con nombre legible.
    if (req.nextUrl.searchParams.get('dl') === '1') {
      const rawName =
        req.nextUrl.searchParams.get('name') ||
        filePath.split('/').pop() ||
        'recording.mp4';
      const ascii = rawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      const encoded = encodeURIComponent(rawName);
      responseHeaders.set(
        'Content-Disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      );
    }

    return new NextResponse(upstream.body, {
      status: upstream.status, // 200 or 206 for range
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse('Camera unavailable', { status: 502 });
  }
}
