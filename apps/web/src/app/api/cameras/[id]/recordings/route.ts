/**
 * Lista los eventos de detección almacenados en la SD de la cámara yi-hack.
 *
 * GET /api/cameras/[id]/recordings?date=YYYYMMDD
 *
 * Usa el CGI endpoint de yi-hack:
 *   - /cgi-bin/eventsfile.sh?dirname=X → archivos de eventos dentro de un directorio
 *
 * NO se usa /cgi-bin/eventsdir.sh: en la cámara tarda ~28 s en enumerar la SD
 * (medido contra el hardware real), mientras que eventsfile.sh responde en
 * ~0,6 s incluso para directorios inexistentes (records vacío). Como los
 * nombres de directorio son deterministas (YYYY"Y"MM"M"DD"D"HH"H", uno por
 * hora), sondeamos directamente las 24 horas de la fecha pedida.
 *
 * Los MP4 de eventos se almacenan en:
 *   <baseUrl>/record/<dirname>/<filename>
 *   p.ej.  /record/2026Y05M12D20H/E235M00S60.mp4
 *
 * Formato del nombre de fichero de evento:
 *   E{?}{MM}M{SS}S{duración}.mp4
 *   - MM/SS se extraen del propio nombre
 *   - Duración en segundos del sufijo S{dur}
 *   - HH:MM viene del campo "time" de eventsfile.sh
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { cameraFetchJsonResult } from '@/lib/camera-fetch';
import { verifyCameraAccess } from '@/lib/camera-access';
import { logCameraEvent } from '@/lib/camera-log';
import { decrypt } from '@/lib/crypto';
import { getDb, cameras, devices } from '@pradomotica/db';

const TIMEOUT_MS = 8_000;

export interface RecordingSegment {
  /** Timestamp de inicio del segmento (ISO 8601) */
  startIso: string;
  /** Duración del segmento en segundos (extraída del nombre de fichero) */
  durationSec: number;
  /** URL relativa para descargar el fragmento desde el proxy */
  proxyUrl: string;
  motion: boolean;
  sound: boolean;
}

/** Grupo de segmentos consecutivos que forman un evento continuo. */
export interface RecordingEvent {
  startIso: string;
  endIso: string;
  durationSec: number;
  type: 'motion' | 'sound' | 'both' | 'recording';
  /** Índices en el array de segmentos (inclusive). */
  firstIndex: number;
  lastIndex: number;
}

interface EventsFileEntry {
  time: string;
  filename: string;
  thumbfilename: string;
}

interface EventsFileResponse {
  error: string;
  date: string;
  records: EventsFileEntry[];
}

async function fetchJsonResult<T>(url: string) {
  return cameraFetchJsonResult<T>(url, TIMEOUT_MS);
}

// ── Caché en memoria de listados ─────────────────────────────────────────────
// Las fechas pasadas son inmutables (la cámara solo escribe en la hora actual),
// así que se cachean de forma indefinida mientras viva el proceso. El día en
// curso se cachea unos segundos para abaratar reaperturas del modal.
interface CachedListing {
  ts: number;
  payload: { segments: RecordingSegment[]; events: RecordingEvent[] };
}
const listingCache = new Map<string, CachedListing>();
const CACHE_MAX_ENTRIES = 200;
const TODAY_TTL_MS = 20_000;

/** Fecha "hoy" en YYYYMMDD según el reloj de la cámara (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function cacheGet(key: string, isPast: boolean): CachedListing['payload'] | null {
  const hit = listingCache.get(key);
  if (!hit) return null;
  if (!isPast && Date.now() - hit.ts > TODAY_TTL_MS) {
    listingCache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key: string, payload: CachedListing['payload']) {
  if (listingCache.size >= CACHE_MAX_ENTRIES) {
    // Descartar la entrada más antigua (orden de inserción del Map)
    const oldest = listingCache.keys().next().value;
    if (oldest !== undefined) listingCache.delete(oldest);
  }
  listingCache.set(key, { ts: Date.now(), payload });
}

/** Extrae la URL base del servidor HTTP de la cámara a partir de la URL de la SD. */
function cameraBaseUrl(sdUrl: string): string {
  try {
    const u = new URL(sdUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return sdUrl;
  }
}

/**
 * Convierte dateParam YYYYMMDD al prefijo de dirname de yi-hack.
 * Ej: "20260512" → "2026Y05M12D"
 */
function dateToDirnamePrefix(date: string): string {
  return `${date.slice(0, 4)}Y${date.slice(4, 6)}M${date.slice(6, 8)}D`;
}

/**
 * Parsea el nombre de fichero de evento para extraer segundos y duración.
 * Formato: E{...}M{SS}S{duración}.mp4
 */
function parseEventFilename(
  filename: string,
): { seconds: number; durationSec: number } | null {
  const match = filename.match(/M(\d+)S(\d+)\.mp4$/i);
  if (!match) return null;
  return {
    seconds: parseInt(match[1]!, 10),
    durationSec: parseInt(match[2]!, 10),
  };
}

/**
 * Parsea el campo "time" de eventsfile.sh.
 * Formato: "Time: HH:MM" o "Time:\nHH:MM"
 */
function parseEventTime(
  timeStr: string,
): { hours: number; minutes: number } | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return {
    hours: parseInt(match[1]!, 10),
    minutes: parseInt(match[2]!, 10),
  };
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

  // Fecha en formato YYYYMMDD, por defecto hoy
  const dateParam =
    req.nextUrl.searchParams.get('date') ??
    new Date().toISOString().slice(0, 10).replace(/-/g, '');

  if (!/^\d{8}$/.test(dateParam)) {
    return new NextResponse('Invalid date', { status: 400 });
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

  if (!row || !row.enabled) return new NextResponse('Not found', { status: 404 });

  const debug = req.nextUrl.searchParams.get('debug') === '1';

  // Priority: explicit SD URL > snapshot URL (extract host) > RTSP URL (extract host, use http://)
  const urlSource = row.sdHttpUrlEnc
    ? 'sdHttpUrlEnc'
    : row.snapshotUrlEnc
      ? 'snapshotUrlEnc'
      : row.rtspUrlEnc
        ? 'rtspUrlEnc'
        : 'none';
  const encUrl = row.sdHttpUrlEnc ?? row.snapshotUrlEnc ?? row.rtspUrlEnc;
  if (!encUrl) {
    return NextResponse.json({
      segments: [],
      events: [],
      ...(debug && { debug: { urlSource, reason: 'no_url_configured' } }),
    });
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
      // RTSP or other non-HTTP URL — derive http://host
      sdBaseUrl = `http://${u.hostname}${u.port ? `:${u.port}` : ''}`;
    }
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  // Validar URL
  try {
    const p = new URL(sdBaseUrl);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') {
      return new NextResponse('Invalid SD URL', { status: 400 });
    }
  } catch {
    return new NextResponse('Invalid SD URL', { status: 400 });
  }

  const camBase = cameraBaseUrl(sdBaseUrl);
  const prefix = dateToDirnamePrefix(dateParam);

  // ── Caché ─────────────────────────────────────────────────────────────────
  const isPast = dateParam < todayUtc();
  const cacheKey = `${id}:${dateParam}`;
  const cached = cacheGet(cacheKey, isPast);
  if (cached) {
    return NextResponse.json({
      ...cached,
      ...(debug && { debug: { urlSource, cached: true } }),
    });
  }

  // Directorios candidatos: un dirname determinista por hora. Para el día en
  // curso no se sondean horas futuras (el reloj de la cámara va en UTC).
  const maxHour =
    dateParam === todayUtc()
      ? new Date().getUTCHours()
      : isPast
        ? 23
        : -1; // fecha futura → nada que sondear
  const candidateDirs = Array.from(
    { length: maxHour + 1 },
    (_, h) => `${prefix}${String(h).padStart(2, '0')}H`,
  );

  if (candidateDirs.length === 0) {
    return NextResponse.json({ segments: [], events: [] });
  }

  // 2. Sondear los ficheros de evento de cada directorio horario.
  //    eventsfile.sh responde en ~0,6 s (también para dirs inexistentes, con
  //    records vacío) y la cámara (mini_httpd) admite pocas conexiones
  //    simultáneas → concurrencia baja. DEADLINE global: fuera de la LAN la
  //    petición pasa por el túnel de Cloudflare, que corta a los ~100 s (524);
  //    respondiendo antes devolvemos como mínimo un listado parcial.
  const CONCURRENCY = 3;
  const DEADLINE_MS = 40_000;
  const t0 = Date.now();
  const deadline = t0 + DEADLINE_MS;
  const year = dateParam.slice(0, 4);
  const month = dateParam.slice(4, 6);
  const day = dateParam.slice(6, 8);

  // Recogemos por directorio para conservar un orden determinista.
  const perDir: (RecordingSegment[] | null)[] = new Array(candidateDirs.length).fill(null);
  let cursor = 0;
  let deadlineHit = false;
  let reachedCamera = false;
  // Horas que no se pudieron leer ni reintentando, con el motivo.
  const failedDirs: { hour: string; error: string }[] = [];

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= candidateDirs.length) return;
      if (Date.now() > deadline) { deadlineHit = true; return; }

      const dirname = candidateDirs[i]!;
      const url = `${camBase}/cgi-bin/eventsfile.sh?dirname=${encodeURIComponent(dirname)}`;
      // mini_httpd rechaza o se cuelga de vez en cuando (sobre todo si a la vez
      // hay un directo tirando de la cámara): un reintento rescata casi todas.
      let res = await fetchJsonResult<EventsFileResponse>(url);
      if (!res.ok && Date.now() + 1_000 < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        res = await fetchJsonResult<EventsFileResponse>(url);
      }

      if (!res.ok) {
        // Antes esta hora se saltaba en silencio y el listado incompleto se
        // cacheaba como bueno — para fechas pasadas, hasta reiniciar la app.
        failedDirs.push({ hour: dirname.slice(-3, -1), error: res.error });
        continue;
      }
      const filesData = res.data;
      reachedCamera = true;

      const out: RecordingSegment[] = [];
      if (filesData.records?.length && filesData.error !== 'true') {
        for (const entry of filesData.records) {
          const parsed = parseEventFilename(entry.filename);
          if (!parsed) continue;

          const time = parseEventTime(entry.time);
          if (!time) continue;

          const hh = String(time.hours).padStart(2, '0');
          const mm = String(time.minutes).padStart(2, '0');
          const ss = String(parsed.seconds).padStart(2, '0');
          // Camera clock is UTC (no local timezone configured) — append 'Z' so
          // the browser parses the timestamp as UTC, matching DB occurredAt values.
          const startIso = `${year}-${month}-${day}T${hh}:${mm}:${ss}Z`;

          out.push({
            startIso,
            durationSec: parsed.durationSec,
            proxyUrl: `/api/cameras/${id}/recordings/segment?dirname=${encodeURIComponent(dirname)}&file=${encodeURIComponent(entry.filename)}`,
            motion: true, // La existencia del fichero implica detección de movimiento
            sound: false,
          });
        }
      }
      perDir[i] = out;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidateDirs.length) }, () => worker()),
  );

  const elapsedMs = Date.now() - t0;
  const errorSummary: Record<string, number> = {};
  for (const f of failedDirs) errorSummary[f.error] = (errorSummary[f.error] ?? 0) + 1;

  if (!reachedCamera) {
    // Ningún sondeo respondió: cámara apagada o fuera de la red. No cachear.
    logCameraEvent({
      deviceId: id,
      stage: 'recordings',
      message: `La cámara no respondió a ninguna consulta de grabaciones (${dateParam})`,
      userId: session.user.id,
      headers: req.headers,
      detail: { date: dateParam, errors: errorSummary, elapsedMs, camHost: new URL(camBase).hostname },
    });
    return NextResponse.json({
      segments: [],
      events: [],
      unreachable: true,
      ...(debug && {
        debug: {
          urlSource,
          camBase: camBase.replace(/\/\/[^/]+@/, '//***@'),
          reason: 'camera_unreachable',
        },
      }),
    });
  }

  const segments: RecordingSegment[] = [];
  for (const arr of perDir) {
    if (arr) segments.push(...arr);
  }

  segments.sort((a, b) => a.startIso.localeCompare(b.startIso));

  // ── Agrupar segmentos consecutivos en eventos ─────────────────────────────
  // Dos segmentos son consecutivos si la diferencia entre el inicio del
  // actual y el final del anterior es ≤ 90 s.
  const events: RecordingEvent[] = [];
  let groupStart = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const prev = i > 0 ? segments[i - 1]! : null;

    const isConsecutive =
      prev &&
      new Date(seg.startIso).getTime() -
        (new Date(prev.startIso).getTime() + prev.durationSec * 1000) <=
        90_000;

    if (!isConsecutive && i > groupStart) {
      const firstSeg = segments[groupStart]!;
      const lastSeg = segments[i - 1]!;
      const start = new Date(firstSeg.startIso);
      const end = new Date(
        new Date(lastSeg.startIso).getTime() + lastSeg.durationSec * 1000,
      );

      const hasMotion = segments.slice(groupStart, i).some((s) => s.motion);
      const hasSound = segments.slice(groupStart, i).some((s) => s.sound);

      events.push({
        startIso: firstSeg.startIso,
        endIso: end.toISOString(),
        durationSec: Math.round((end.getTime() - start.getTime()) / 1000),
        type:
          hasMotion && hasSound
            ? 'both'
            : hasMotion
              ? 'motion'
              : 'sound',
        firstIndex: groupStart,
        lastIndex: i - 1,
      });
      groupStart = i;
    }
  }

  // Cerrar el último grupo
  if (segments.length > 0) {
    const firstSeg = segments[groupStart]!;
    const lastSeg = segments[segments.length - 1]!;
    const start = new Date(firstSeg.startIso);
    const end = new Date(
      new Date(lastSeg.startIso).getTime() + lastSeg.durationSec * 1000,
    );
    const hasMotion = segments.slice(groupStart).some((s) => s.motion);
    const hasSound = segments.slice(groupStart).some((s) => s.sound);

    events.push({
      startIso: firstSeg.startIso,
      endIso: end.toISOString(),
      durationSec: Math.round((end.getTime() - start.getTime()) / 1000),
      type:
        hasMotion && hasSound
          ? 'both'
          : hasMotion
            ? 'motion'
            : 'sound',
      firstIndex: groupStart,
      lastIndex: segments.length - 1,
    });
  }

  const partial = deadlineHit || failedDirs.length > 0;
  if (partial) {
    logCameraEvent({
      deviceId: id,
      level: 'warn',
      stage: 'recordings',
      message: deadlineHit
        ? `Listado de grabaciones cortado a los ${Math.round(elapsedMs / 1000)} s (cámara lenta)`
        : `No se pudieron leer ${failedDirs.length} de ${candidateDirs.length} horas de grabaciones`,
      userId: session.user.id,
      headers: req.headers,
      detail: {
        date: dateParam,
        failedHours: failedDirs.map((f) => f.hour),
        errors: errorSummary,
        elapsedMs,
      },
    });
  }

  // Cachear solo listados completos: los parciales (deadline u horas que no
  // respondieron) se reintentarán en la siguiente apertura.
  if (!partial) {
    cacheSet(cacheKey, { segments, events });
  }

  return NextResponse.json({
    segments,
    events,
    partial,
    ...(failedDirs.length > 0 && { failedHours: failedDirs.map((f) => f.hour) }),
  });
}
