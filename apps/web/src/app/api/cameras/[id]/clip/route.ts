/**
 * GET /api/cameras/[id]/clip?file=rec_20260519_143000.mp4
 *
 * Proxies an MP4 clip file from the tablet's local HTTP server
 * (http://tablet-ip:8080/api/clips/{filename}) through Avyra.
 *
 * Needed because the tablet IP is on the local LAN and is not
 * directly reachable by the browser (which connects via Cloudflare tunnel).
 *
 * Supports Range requests so the browser can seek within the video.
 * Path traversal protection: only bare filenames (no slashes, no ..) allowed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { getDb, cameras, devices } from '@pradomotica/db';

export const dynamic = 'force-dynamic';

// Only allow safe bare filenames: alphanumeric + underscore/dash/dot, must end in .mp4
const SAFE_FILENAME_RE = /^[a-z0-9_\-.]+\.mp4$/i;

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

  // Reject any path traversal attempts
  if (rawFile.includes('..') || rawFile.includes('/') || rawFile.includes('\\')) {
    return new NextResponse('Invalid filename', { status: 400 });
  }
  if (!SAFE_FILENAME_RE.test(rawFile)) {
    return new NextResponse('Invalid filename', { status: 400 });
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

  let clipUrl: string;
  let authHeader: string;
  try {
    const parsed = new URL(rtspUrl);
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const base = `http://${parsed.hostname}:${parsed.port}`;
    clipUrl = `${base}/api/clips/${encodeURIComponent(rawFile)}`;
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
    const upstream = await fetch(clipUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new NextResponse('Clip not found', { status: upstream.status });
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
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'private, max-age=3600');

    return new NextResponse(upstream.body, {
      status: upstream.status, // 200 or 206 for range requests
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse('Camera unavailable', { status: 502 });
  }
}
