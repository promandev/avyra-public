/**
 * GET /api/cameras/[id]/ipwebcam-recordings?date=YYYYMMDD
 *
 * Lists recordings from an IP Webcam device or a tablet running the Avyra APK.
 * - IP Webcam: hits /list_videos and returns modet_* motion-triggered recordings.
 * - Tablet (model === 'Tablet'): hits /api/recordings and returns continuous segments.
 *
 * Returns the same RecordingSegment shape that the regular /recordings endpoint uses.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { getDb, cameras, devices } from '@pradomotica/db';

export const dynamic = 'force-dynamic';

interface IpWebcamFile {
  path: string;
  name: string;
  size: string;
  mtime: string; // Unix seconds
}

interface ApkRecording {
  id: number;
  path: string;
  startTs: number; // epoch ms
  endTs: number;   // epoch ms
  sizeBytes: number;
}

export interface IpWebcamRecordingSegment {
  startIso: string;   // ISO 8601 (parsed from filename as local time)
  mtimeMs: number;    // Unix ms — reliable UTC end-of-file timestamp
  durationSec: number;
  proxyUrl: string;
  motion: boolean;
  sound: boolean;
  /** True si la grabación está marcada como favorita en la APK (solo lectura). */
  favorite?: boolean;
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
  if (!/^\d{8}$/.test(dateParam))
    return new NextResponse('Invalid date', { status: 400 });

  const db = getDb();
  const [row] = await db
    .select({ rtspUrlEnc: cameras.rtspUrlEnc, enabled: devices.enabled, model: cameras.model })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  if (!row || !row.enabled || !row.rtspUrlEnc) {
    return NextResponse.json({ segments: [] });
  }

  let rtspUrl: string;
  try {
    rtspUrl = decrypt(row.rtspUrlEnc);
  } catch {
    return NextResponse.json({ segments: [] });
  }

  let baseUrl: string;
  let authHeader: string;
  try {
    const parsed = new URL(rtspUrl);
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    baseUrl = `http://${parsed.hostname}:${parsed.port}`;
    authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } catch {
    return NextResponse.json({ segments: [] });
  }

  // ── Tablet (Avyra APK): use /api/recordings ──────────────────────────────
  if (row.model === 'Tablet') {
    let apkRecs: ApkRecording[];
    let apkFavs: ApkRecording[] = [];
    try {
      // La APK mantiene los favoritos en una lista APARTE: una grabación marcada
      // como favorita DESAPARECE de /api/recordings y solo aparece en
      // /api/recordings/favorites. Por eso pedimos ambas y las fusionamos en un
      // único listado ordenado por tiempo; si no, los favoritos no se verían en
      // Avyra ("como si hubieran cambiado de ubicación"). El marcado de favorito
      // solo se puede hacer desde la propia APK: aquí es de solo lectura.
      // El fetch de favoritos es tolerante a fallos.
      const [recsRes, favRes] = await Promise.all([
        fetch(`${baseUrl}/api/recordings`, {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${baseUrl}/api/recordings/favorites`, {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null),
      ]);
      if (!recsRes.ok) return NextResponse.json({ segments: [] });
      apkRecs = (await recsRes.json()) as ApkRecording[];
      if (favRes && favRes.ok) {
        apkFavs = (await favRes.json()) as ApkRecording[];
      }
    } catch {
      return NextResponse.json({ segments: [] });
    }

    // Filter by UTC date matching dateParam (YYYYMMDD)
    const year = parseInt(dateParam.slice(0, 4), 10);
    const month = parseInt(dateParam.slice(4, 6), 10) - 1;
    const day = parseInt(dateParam.slice(6, 8), 10);
    const dayStartMs = Date.UTC(year, month, day, 0, 0, 0, 0);
    const dayEndMs   = Date.UTC(year, month, day + 1, 0, 0, 0, 0);

    // Fusionar normales + favoritos, deduplicando por id (favorito gana).
    const byId = new Map<number, { rec: ApkRecording; favorite: boolean }>();
    for (const rec of apkRecs) byId.set(rec.id, { rec, favorite: false });
    for (const rec of apkFavs) byId.set(rec.id, { rec, favorite: true });

    const segments: IpWebcamRecordingSegment[] = [...byId.values()]
      .filter(({ rec }) => rec.sizeBytes > 0 && rec.startTs >= dayStartMs && rec.startTs < dayEndMs)
      .map(({ rec, favorite }) => ({
        startIso: new Date(rec.startTs).toISOString(),
        mtimeMs: rec.endTs,
        durationSec: Math.max(0, Math.round((rec.endTs - rec.startTs) / 1000)),
        proxyUrl: `/api/cameras/${id}/tablet-recording/${rec.id}`,
        motion: false,
        sound: false,
        favorite,
      }));

    segments.sort((a, b) => a.startIso.localeCompare(b.startIso));
    return NextResponse.json({ segments });
  }

  // ── IP Webcam: use /list_videos ──────────────────────────────────────────
  let files: IpWebcamFile[];
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${baseUrl}/list_videos`, {
      headers: { Authorization: authHeader },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return NextResponse.json({ segments: [] });
    files = (await res.json()) as IpWebcamFile[];
  } catch {
    return NextResponse.json({ segments: [] });
  }

  const dateStr = `${dateParam.slice(0, 4)}-${dateParam.slice(4, 6)}-${dateParam.slice(6, 8)}`;

  const segments: IpWebcamRecordingSegment[] = [];

  for (const file of files) {
    if (!file.name.startsWith('modet_')) continue;
    if (!file.name.includes(dateStr)) continue;
    const size = parseInt(file.size, 10);
    if (size === 0) continue; // skip empty / in-progress files

    // Parse local start time from filename: modet_YYYY-MM-DD_HH-mm.mp4
    const match = file.name.match(/modet_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})/);
    if (!match) continue;

    // Parse as local time on the server (assumes server and device share timezone)
    const startDate = new Date(`${match[1]}T${match[2]}:${match[3]}:00`);
    if (isNaN(startDate.getTime())) continue;

    const mtimeSec = parseInt(file.mtime, 10);
    const mtimeMs = mtimeSec * 1000;
    const durationSec = Math.max(0, Math.round(mtimeSec - startDate.getTime() / 1000));

    const filePath = encodeURIComponent(`${file.path}/${file.name}`);

    segments.push({
      startIso: startDate.toISOString(),
      mtimeMs,
      durationSec,
      proxyUrl: `/api/cameras/${id}/ipwebcam-video?file=${filePath}`,
      motion: true,
      sound: false,
    });
  }

  segments.sort((a, b) => a.startIso.localeCompare(b.startIso));

  return NextResponse.json({ segments });
}
