/**
 * Proxy de segmentos MP4 almacenados en la SD de la cámara.
 *
 * Formatos soportados:
 *   GET /api/cameras/[id]/recordings/segment?dirname=2026Y05M12D20H&file=E235M00S60.mp4
 *   GET /api/cameras/[id]/recordings/segment?date=YYYYMMDD&hh=HH&file=MMSS.mp4   (legacy)
 *
 * Nunca expone la URL real de la cámara al cliente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { cameraProxyStream } from '@/lib/camera-fetch';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { getDb, cameras, devices } from '@pradomotica/db';

const TIMEOUT_MS = 30_000;

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
  const { searchParams } = req.nextUrl;
  const dirname = searchParams.get('dirname');
  const date = searchParams.get('date');
  const hh = searchParams.get('hh');
  const file = searchParams.get('file');

  if (!file) {
    return new NextResponse('Missing file param', { status: 400 });
  }

  // Validar nombre de fichero: solo MP4, sin path traversal
  if (!/^[\w.-]+\.mp4$/i.test(file)) {
    return new NextResponse('Invalid file', { status: 400 });
  }

  // Construir la ruta relativa según el formato
  let relativePath: string;

  if (dirname) {
    // Formato evento: /record/<dirname>/<file>
    // dirname: "2026Y05M12D20H"
    if (!/^\d{4}Y\d{2}M\d{2}D\d{2}H$/.test(dirname)) {
      return new NextResponse('Invalid dirname', { status: 400 });
    }
    relativePath = `/record/${dirname}/${file}`;
  } else if (date && hh) {
    // Formato legacy: /record/<date>/<hh>/<file>
    if (!/^\d{8}$/.test(date) || !/^\d{2}$/.test(hh)) {
      return new NextResponse('Invalid params', { status: 400 });
    }
    relativePath = `/record/${date}/${hh}/${file}`;
  } else {
    return new NextResponse('Missing dirname or date+hh params', { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .select({
      sdHttpUrlEnc: cameras.sdHttpUrlEnc,
      snapshotUrlEnc: cameras.snapshotUrlEnc,
      rtspUrlEnc: cameras.rtspUrlEnc,
      enabled: devices.enabled,
    })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  const encUrl = row?.sdHttpUrlEnc ?? row?.snapshotUrlEnc ?? row?.rtspUrlEnc;
  if (!row || !row.enabled || !encUrl) {
    return new NextResponse('Not found', { status: 404 });
  }

  let sdBaseUrl: string;
  try {
    const raw = decrypt(encUrl).replace(/\/$/, '');
    const u = new URL(raw);
    if (row.sdHttpUrlEnc) {
      sdBaseUrl = raw;
    } else if (u.protocol === 'http:' || u.protocol === 'https:') {
      sdBaseUrl = `${u.protocol}//${u.host}`;
    } else {
      sdBaseUrl = `http://${u.hostname}${u.port ? `:${u.port}` : ''}`;
    }
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  const camBase = (() => {
    try {
      const u = new URL(sdBaseUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return sdBaseUrl;
    }
  })();

  const segmentUrl = `${camBase}${relativePath}`;

  // Validar URL construida
  try {
    const p = new URL(segmentUrl);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') {
      return new NextResponse('Invalid URL', { status: 400 });
    }
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  try {
    const upstream = await cameraProxyStream(segmentUrl, {
      timeoutMs: TIMEOUT_MS,
      rangeHeader: req.headers.get('Range'),
      contentType: 'video/mp4',
    });

    // Descarga al dispositivo: forzar attachment con nombre legible.
    if (searchParams.get('dl') === '1' && upstream.ok) {
      const rawName = searchParams.get('name') || file;
      const ascii = rawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      const encoded = encodeURIComponent(rawName);
      const headers = new Headers(upstream.headers);
      headers.set(
        'Content-Disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      );
      return new NextResponse(upstream.body, { status: upstream.status, headers });
    }

    return upstream;
  } catch {
    return new NextResponse('Proxy error', { status: 502 });
  }
}
