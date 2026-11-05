/**
 * GET /api/cameras/[id]/live-stream
 *
 * Proxies the live MJPEG stream from the Avyra tablet APK
 * (http://tablet-ip:8080/api/stream) through Avyra.
 *
 * Used for tablet cameras as a simpler alternative to WebRTC/go2rtc.
 * The browser displays this via an <img> element which natively
 * supports multipart/x-mixed-replace MJPEG streams.
 *
 * Connection lifetime mirrors the browser request: when the user closes
 * the camera modal the browser drops the connection and the upstream
 * fetch is aborted automatically via req.signal.
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
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
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
    streamUrl = `${base}/api/stream`;
    authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  try {
    // req.signal ties this fetch to the browser connection lifetime:
    // when the user closes the modal the browser aborts the request,
    // which aborts the upstream fetch and releases the tablet connection.
    const upstream = await fetch(streamUrl, {
      headers: { Authorization: authHeader },
      signal: req.signal,
    });

    if (!upstream.ok) {
      return new NextResponse('Camera unavailable', { status: upstream.status });
    }

    const responseHeaders = new Headers();
    responseHeaders.set(
      'Content-Type',
      upstream.headers.get('Content-Type') ?? 'multipart/x-mixed-replace; boundary=--frame',
    );
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    return new NextResponse(upstream.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse('Camera unavailable', { status: 502 });
  }
}
