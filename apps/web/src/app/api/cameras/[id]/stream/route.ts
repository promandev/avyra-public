/**
 * Proxy HLS hacia go2rtc.
 *
 * go2rtc v1.9+ usa un esquema HLS de dos niveles con rutas RELATIVAS:
 *   1. Master:       GET /api/stream.m3u8?src=ID
 *        → ref:  hls/playlist.m3u8?id=XXX   (relativa a /api/  →  /api/hls/...)
 *   2. Sub-playlist: GET /api/hls/playlist.m3u8?id=XXX
 *        → ref:  segment.ts?id=XXX&n=N      (relativa a /api/hls/  →  /api/hls/segment.ts...)
 *   3. Segmento:     GET /api/hls/segment.ts?id=XXX&n=N
 *
 * Como las refs son relativas, este proxy las resuelve a su ruta absoluta en
 * go2rtc y las reescribe para que pasen por la app (HTTPS vía Cloudflare),
 * funcionando desde cualquier red. El parámetro `seg` lleva la ruta absoluta
 * upstream (URL-encoded).
 *
 * Rutas:
 *   GET /api/cameras/[id]/stream          → master playlist (reescrito)
 *   GET /api/cameras/[id]/stream?seg=...  → sub-playlist o segmento (proxy)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { logCameraEvent } from '@/lib/camera-log';
import { buildGo2rtcSource } from '@/lib/go2rtc-source';
import { getDb, cameras, devices } from '@pradomotica/db';

const TIMEOUT_MS = 10_000;

// ── Token efímero para sub-recursos HLS ──────────────────────────────────────
// El reproductor HLS nativo de iOS/Safari descarga sub-playlists y segmentos
// desde el proceso multimedia del sistema, que NO envía las cookies de sesión
// (verificado en producción: el master llega autenticado y las peticiones de
// segmentos no llegan nunca → 401 silencioso → "Error al establecer conexión").
// Por eso cada URL reescrita lleva un HMAC de corta vida ligado a la cámara:
// quien obtuvo el master (autenticado con sesión) puede descargar sus
// segmentos durante unos minutos sin depender de cookies.
const HLS_TOKEN_TTL_MS = 30 * 60_000;

// La caducidad se redondea a una rejilla para que una misma URL se firme
// IGUAL en cada relectura del playlist. Con `exp` a reloj vivo, cada poll
// (2 por segundo) devolvía una URL distinta para el mismo recurso: hls.js veía
// un `#EXT-X-MAP` nuevo cada vez, recargaba el segmento de inicialización y
// reiniciaba el buffer antes de poder consumir vídeo — el directo se quedaba
// en el primer fotograma (segmentos 0-2 y parada). Con la rejilla, la URL solo
// cambia al cruzar de tramo, así que el reproductor la ve estable.
const HLS_TOKEN_GRID_MS = 15 * 60_000;

function hlsExpiry(): number {
  return Math.ceil((Date.now() + HLS_TOKEN_TTL_MS) / HLS_TOKEN_GRID_MS) * HLS_TOKEN_GRID_MS;
}

function hlsToken(cameraId: string, exp: number): string {
  return createHmac('sha256', env.AUTH_SECRET)
    .update(`hls:${cameraId}:${exp}`)
    .digest('base64url');
}

function verifyHlsToken(cameraId: string, tk: string | null, expStr: string | null): boolean {
  if (!tk || !expStr) return false;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = hlsToken(cameraId, exp);
  const a = Buffer.from(tk);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureStream(streamId: string, rtspUrl: string): Promise<boolean> {
  // buildGo2rtcSource es la MISMA función que usa /webrtc — ambos consumidores
  // comparten el stream en go2rtc (mismo streamId), así que deben registrar
  // exactamente el mismo source o se pisarían el uno al otro en cada PUT/PATCH.
  const src = buildGo2rtcSource(rtspUrl);
  try {
    const listRes = await fetch(`${env.GO2RTC_URL}/api/streams`, {
      signal: AbortSignal.timeout(3000),
    });
    if (listRes.ok) {
      const streams: Record<string, unknown> = await listRes.json();
      if (streamId in streams) {
        const patchRes = await fetch(
          `${env.GO2RTC_URL}/api/streams?src=${encodeURIComponent(src)}&name=${encodeURIComponent(streamId)}`,
          { method: 'PATCH', signal: AbortSignal.timeout(5000) },
        );
        return patchRes.ok;
      }
    }
    const addRes = await fetch(
      `${env.GO2RTC_URL}/api/streams?src=${encodeURIComponent(src)}&name=${encodeURIComponent(streamId)}`,
      { method: 'PUT', signal: AbortSignal.timeout(5000) },
    );
    return addRes.ok;
  } catch {
    return false;
  }
}

/**
 * Resuelve una referencia relativa de un m3u8 a su ruta absoluta upstream
 * (pathname + query), usando `basePath` como base del documento.
 *  base '/api/stream.m3u8'  + ref 'hls/playlist.m3u8?id=X'  → '/api/hls/playlist.m3u8?id=X'
 *  base '/api/hls/playlist.m3u8' + ref 'segment.ts?id=X&n=0' → '/api/hls/segment.ts?id=X&n=0'
 */
function resolveUpstream(basePath: string, ref: string): string {
  const u = new URL(ref, `http://x${basePath}`);
  return u.pathname + u.search;
}

// Reescribe cada línea-URL de un m3u8 para que apunte al proxy de la app,
// firmando cada URL con el token efímero (ver arriba). Los sub-playlists se
// re-reescriben en cada poll, así que el token se renueva solo mientras se
// reproduce.
function rewriteM3u8(text: string, cameraId: string, basePath: string): string {
  const exp = hlsExpiry();
  const tk = hlsToken(cameraId, exp);
  const proxied = (ref: string): string => {
    const upstream = resolveUpstream(basePath, ref);
    return `/api/cameras/${cameraId}/stream?seg=${encodeURIComponent(upstream)}&exp=${exp}&tk=${tk}`;
  };

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      // Las etiquetas también pueden llevar URLs en un atributo `URI="..."`:
      // en modo fMP4 el segmento de inicialización viaja en #EXT-X-MAP, y sin
      // reescribirlo el reproductor lo pide relativo a ESTA ruta
      // (/api/cameras/<id>/init.mp4?…), que no existe → 404 y no arranca el
      // vídeo. Afecta igual a #EXT-X-KEY y #EXT-X-MEDIA.
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (whole, ref: string) =>
          /^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref) ? whole : `URI="${proxied(ref)}"`,
        );
      }
      return proxied(trimmed);
    })
    .join('\n');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = req.nextUrl;
  const seg = searchParams.get('seg');

  // Sub-recursos: el token HMAC de la URL autoriza sin cookie (iOS/Safari no
  // la envía desde su pipeline multimedia). El master exige sesión SIEMPRE.
  const tokenOk = seg !== null && verifyHlsToken(id, searchParams.get('tk'), searchParams.get('exp'));

  let userId: string | null = null;
  if (!tokenOk) {
    const session = await auth();
    if (!session?.user?.id) {
      console.error(
        `[hls] 401 ${seg ? 'seg' : 'master'} ${id} — cookie=${req.headers.get('cookie') ? 'sí' : 'no'} tk=${searchParams.get('tk') ? 'inválido' : 'ausente'} ua="${(req.headers.get('user-agent') ?? '').slice(0, 60)}"`,
      );
      logCameraEvent({
        deviceId: id,
        level: 'warn',
        stage: seg ? 'hls-seg' : 'hls-master',
        httpStatus: 401,
        message: seg
          ? `Sin sesión ni token válido (token ${searchParams.get('tk') ? 'caducado o inválido' : 'ausente'})`
          : 'Sin sesión al pedir el directo HLS',
        headers: req.headers,
      });
      return new NextResponse('Unauthorized', { status: 401 });
    }
    userId = session.user.id;
    if (!(await verifyCameraAccess(id, session.user.id))) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  // ── Proxy de sub-recurso (sub-playlist o segmento) ──────────────────────
  // `seg` es la ruta absoluta upstream en go2rtc (p.ej. /api/hls/segment.ts?id=X&n=0).
  // El acceso a la cámara ya está verificado arriba; no hace falta consultar la BD otra vez.
  if (seg) {
    // Validación: solo permitir rutas HLS de go2rtc (evita SSRF a rutas arbitrarias)
    if (!seg.startsWith('/api/hls/')) {
      return new NextResponse('Invalid segment', { status: 400 });
    }
    const upstreamUrl = `${env.GO2RTC_URL}${seg}`;
    try {
      const upstream = await fetch(upstreamUrl, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!upstream.ok) {
        console.error(`[hls] seg ${seg} → upstream ${upstream.status}`);
        // 404 de go2rtc = la sesión HLS ya no existe: caduca a los ~6 s sin
        // descargas de segmentos (pestaña en segundo plano, red lenta…).
        const what = seg.includes('.m3u8') ? 'playlist' : 'segmento';
        logCameraEvent({
          deviceId: id,
          level: 'warn',
          stage: 'hls-seg',
          httpStatus: upstream.status,
          message:
            upstream.status === 404
              ? `Sesión HLS caducada en go2rtc (${what})`
              : `go2rtc respondió ${upstream.status} a un ${what}`,
          userId,
          headers: req.headers,
        });
        return new NextResponse('Segment unavailable', { status: upstream.status });
      }

      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const isPlaylist = seg.includes('.m3u8') || contentType.includes('mpegurl');

      // Trazar el arranque de cada sesión de reproducción: playlists siempre,
      // segmentos solo los primeros (evita ruido: hay ~2 por segundo).
      const segN = /[?&]n=(\d+)/.exec(seg)?.[1];
      const isInit = seg.includes('init.mp4');
      if (isPlaylist || isInit || (segN !== undefined && Number(segN) <= 2)) {
        console.log(
          `[hls] ${isPlaylist ? 'playlist' : isInit ? 'init' : `seg n=${segN}`} ${id} OK (auth=${tokenOk ? 'token' : 'sesión'})`,
        );
      }

      if (isPlaylist) {
        const text = await upstream.text();
        // basePath = ruta del sub-playlist (sin query) para resolver los segment.ts
        const basePath = seg.split('?')[0] ?? seg;
        return new NextResponse(rewriteM3u8(text, id, basePath), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-store',
          },
        });
      }

      // Segmento binario (.m4s/.mp4 en modo fMP4, .ts en modo TS) — devolver
      // tal cual con el content-type correcto (Safari es estricto con esto).
      const body = await upstream.arrayBuffer();
      const isMp4Seg = /\.(m4s|mp4)(\?|$)/.test(seg);
      const binType = contentType.includes('mp4') || contentType.includes('mp2t')
        ? contentType
        : isMp4Seg
          ? 'video/mp4'
          : 'video/mp2t';
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': binType,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      logCameraEvent({
        deviceId: id,
        stage: 'hls-seg',
        httpStatus: 502,
        message: `Error pidiendo ${seg.includes('.m3u8') ? 'playlist' : 'segmento'} a go2rtc: ${errText(err)}`,
        userId,
        headers: req.headers,
      });
      return new NextResponse('Segment error', { status: 502 });
    }
  }

  // ── Master playlist ──────────────────────────────────────────────────────
  const db = getDb();
  const [row] = await db
    .select({
      rtspUrlEnc: cameras.rtspUrlEnc,
      go2rtcStreamId: cameras.go2rtcStreamId,
      enabled: devices.enabled,
    })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  if (!row || !row.enabled) return new NextResponse('Not found', { status: 404 });
  if (!row.rtspUrlEnc) {
    return new NextResponse('No RTSP URL configured', { status: 422 });
  }

  let rtspUrl: string;
  try {
    rtspUrl = decrypt(row.rtspUrlEnc);
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  try {
    const parsed = new URL(rtspUrl);
    if (!['rtsp:', 'http:', 'https:'].includes(parsed.protocol)) {
      return new NextResponse('Invalid stream URL', { status: 400 });
    }
  } catch {
    return new NextResponse('Invalid stream URL', { status: 400 });
  }

  const streamId = row.go2rtcStreamId ?? id;

  const ok = await ensureStream(streamId, rtspUrl);
  if (!ok) {
    logCameraEvent({
      deviceId: id,
      stage: 'hls-master',
      httpStatus: 503,
      message: 'go2rtc no responde al registrar el stream',
      userId,
      headers: req.headers,
    });
    return new NextResponse('go2rtc unavailable', { status: 503 });
  }

  // La propia petición del master m3u8 arranca el producer (lazy start de
  // ffmpeg): go2rtc crea un consumer HLS al servirlo. NO usar stream.mp4 como
  // "kick": cancelar su body hace que go2rtc escriba sobre la conexión cerrada
  // y muera con SIGSEGV (panic en WriteBuffer.Flush), tirando TODOS los directos.
  // Reintentar hasta ~14 s: ffmpeg tarda en arrancar (cámaras RTSP con auth
  // pueden tardar ~9 s) y el master m3u8 puede llegar sin la ref `hls/` hasta
  // que go2rtc tenga el primer keyframe.
  const t0 = Date.now();
  // Motivo de cada intento fallido, para el registro si se agotan.
  const reasons: string[] = [];
  for (let attempt = 0; attempt < 14; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
    try {
      // `&mp4` → HLS con segmentos fMP4 (init.mp4 + segment.m4s) en vez de TS.
      // Imprescindible para el AVPlayer de iOS/Safari: con los segmentos TS de
      // 0,5 s de go2rtc descarga los 2-3 primeros y deja de consumir (la sesión
      // muere por inactividad → 404). Verificado contra el go2rtc real.
      const upstream = await fetch(
        `${env.GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(streamId)}&mp4`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!upstream.ok) {
        reasons.push(`HTTP ${upstream.status}`);
        continue;
      }

      const text = await upstream.text();
      if (!text.includes('hls/')) {
        reasons.push('sin playlist (la cámara aún no da imagen)');
        continue; // Todavía no hay playlist válido
      }

      console.log(
        `[hls] master ${id} OK (intento ${attempt + 1}, ${Date.now() - t0} ms)`,
      );
      // Un arranque lento no es un fallo, pero explica esperas largas.
      if (attempt >= 5) {
        logCameraEvent({
          deviceId: id,
          level: 'info',
          stage: 'hls-master',
          message: `Directo HLS listo tras ${attempt + 1} intentos (${Date.now() - t0} ms)`,
          userId,
          headers: req.headers,
          detail: { reasons: summarize(reasons) },
        });
      }
      return new NextResponse(rewriteM3u8(text, id, '/api/stream.m3u8'), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      reasons.push(errText(err)); // Ignorar y reintentar
    }
  }

  console.error(`[hls] master ${id} AGOTADO tras ${Date.now() - t0} ms → 503`);
  logCameraEvent({
    deviceId: id,
    stage: 'hls-master',
    httpStatus: 503,
    message: `go2rtc no consiguió imagen de la cámara en ${Math.round((Date.now() - t0) / 1000)} s`,
    userId,
    headers: req.headers,
    detail: { reasons: summarize(reasons) },
  });
  return new NextResponse('Stream unavailable', { status: 503 });
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    return err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : err.message;
  }
  return String(err);
}

/** Agrupa motivos repetidos: ["timeout", "timeout", "HTTP 500"] → { timeout: 2, "HTTP 500": 1 }. */
function summarize(reasons: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}
