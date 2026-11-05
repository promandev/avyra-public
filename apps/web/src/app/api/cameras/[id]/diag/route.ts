/**
 * Diagnóstico de audio/vídeo para una cámara.
 *
 * GET /api/cameras/[id]/diag
 *
 * Consulta go2rtc sobre el estado del stream y los codecs detectados.
 * Analiza el SDP de la cámara para determinar si envía audio.
 * Si no hay audio, intenta probar URLs RTSP alternativas con audio.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { getDb, cameras, devices } from '@pradomotica/db';

// ── Tipos reales de la API de go2rtc ────────────────────────────────────────

interface Go2rtcCodec {
  codec_name?: string;
  codec_type?: string; // "video" | "audio"
  profile?: string;
  level?: number;
}

interface Go2rtcReceiver {
  id?: number;
  codec?: Go2rtcCodec;
  bytes?: number;
  packets?: number;
}

interface Go2rtcProducer {
  id?: number;
  url?: string;
  format_name?: string;
  protocol?: string;
  remote_addr?: string;
  sdp?: string;
  medias?: string[];           // ej. ["video, recvonly, H264"]
  receivers?: Go2rtcReceiver[];
  bytes_recv?: number;
}

interface Go2rtcStream {
  producers?: Go2rtcProducer[];
  consumers?: unknown[];
}

export async function GET(
  _req: NextRequest,
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

  const streamId = row.go2rtcStreamId ?? id;
  let rtspUrl: string | null = null;
  if (row.rtspUrlEnc) {
    try { rtspUrl = decrypt(row.rtspUrlEnc); } catch { /* ignore */ }
  }

  // ── Consultar go2rtc ──────────────────────────────────────────────────────
  let go2rtcReachable = false;
  let streamExists = false;
  let streamActive = false; // tiene producer conectado (no solo configurado)
  const tracks: { codec: string; type: string; profile?: string }[] = [];
  const mediaLines: string[] = [];
  let sdp: string | null = null;
  let go2rtcError: string | null = null;

  // Declarados aquí para que el bloque try también pueda hacer push
  const issues: string[] = [];
  const suggestions: string[] = [];

  try {
    // Primero verificar que go2rtc está accesible
    const pingRes = await fetch(`${env.GO2RTC_URL}/api/streams`, {
      signal: AbortSignal.timeout(3000),
    });

    if (pingRes.ok) {
      go2rtcReachable = true;
      const initialStreams: Record<string, Go2rtcStream> = await pingRes.json();

      if (!(streamId in initialStreams)) {
        // Stream no registrado: registrarlo ahora
        if (rtspUrl) {
          await fetch(
            `${env.GO2RTC_URL}/api/streams?src=${encodeURIComponent(rtspUrl)}&name=${encodeURIComponent(streamId)}`,
            { method: 'PUT', signal: AbortSignal.timeout(3000) },
          ).catch(() => undefined);
        }
      }

      // Forzar a go2rtc a conectarse al RTSP pidiendo el master m3u8 HLS: la
      // petición arranca el producer y la respuesta se completa en el servidor.
      // NO usar stream.mp4 abortado a medias: go2rtc escribe sobre la conexión
      // cerrada y muere con SIGSEGV (panic en WriteBuffer.Flush).
      try {
        const r = await fetch(
          `${env.GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(streamId)}`,
          { signal: AbortSignal.timeout(6000) },
        );
        await r.text().catch(() => undefined);
      } catch {
        // timeout esperado si el producer tarda en arrancar
      }

      // Esperar a que go2rtc negocie el SDP completo
      await new Promise((r) => setTimeout(r, 2000));

      // Ahora leer la info del stream con conexión activa
      const streamsRes = await fetch(`${env.GO2RTC_URL}/api/streams`, {
        signal: AbortSignal.timeout(5000),
      });

      if (streamsRes.ok) {
        const allStreams: Record<string, Go2rtcStream> = await streamsRes.json();

        if (streamId in allStreams) {
          streamExists = true;
          const stream = allStreams[streamId]!;

          let hasFfmpegProducer = false;
          let ffmpegProducerActive = false;

          for (const producer of stream.producers ?? []) {
            // Un producer está activo si tiene id (está conectado, no solo configurado)
            if (producer.id != null) {
              streamActive = true;
            }

            // Rastrear el producer ffmpeg de audio Opus (necesario para WebRTC)
            if (producer.url?.startsWith('ffmpeg:')) {
              hasFfmpegProducer = true;
              if (producer.id != null) ffmpegProducerActive = true;
            }

            // Extraer medias (strings como "video, recvonly, H264")
            if (producer.medias) {
              for (const m of producer.medias) {
                mediaLines.push(m);
              }
            }

            // Extraer tracks reales de los receivers
            if (producer.receivers) {
              for (const recv of producer.receivers) {
                if (recv.codec?.codec_name) {
                  tracks.push({
                    codec: recv.codec.codec_name.toUpperCase(),
                    type: recv.codec.codec_type ?? 'unknown',
                    profile: recv.codec.profile ?? undefined,
                  });
                }
              }
            }

            // Guardar SDP para análisis
            if (producer.sdp) {
              sdp = producer.sdp;
            }
          }

          // Si go2rtc recibe audio (AAC) del RTSP pero el producer ffmpeg de Opus
          // no está activo, WebRTC no tendrá pista de audio aunque el diagnóstico
          // muestre hasAudioTrack = true.
          if (hasFfmpegProducer && !ffmpegProducerActive) {
            issues.push(
              'El producer ffmpeg (transcodificación AAC→Opus) no está conectado. ' +
              'go2rtc recibe audio de la cámara pero no puede enviarlo vía WebRTC sin Opus. ' +
              'Abre la cámara de nuevo para que el reproductor lo arranque automáticamente.',
            );
          }
        } else {
          go2rtcError = `Stream "${streamId}" no está registrado en go2rtc`;
        }
      } else {
        go2rtcError = `go2rtc respondió con HTTP ${streamsRes.status}`;
      }
    } else {
      go2rtcError = `go2rtc no accesible`;
    }
  } catch (err) {
    go2rtcError = `go2rtc no accesible: ${err instanceof Error ? err.message : String(err)}`;
  }

  // ── Análisis del SDP ──────────────────────────────────────────────────────
  const sdpHasVideo = sdp ? /^m=video/m.test(sdp) : false;
  const sdpHasAudio = sdp ? /^m=audio/m.test(sdp) : false;
  const hasVideoTrack = tracks.some((t) => t.type === 'video') || mediaLines.some((m) => m.startsWith('video'));
  const hasAudioTrack = tracks.some((t) => t.type === 'audio') || mediaLines.some((m) => m.startsWith('audio'));

  // ── Probar URLs RTSP alternativas con audio ───────────────────────────────
  let alternativeUrls: { url: string; hasAudio: boolean; error?: string }[] = [];

  if (rtspUrl && !hasAudioTrack && go2rtcReachable) {
    try {
      const url = new URL(rtspUrl);
      const host = url.hostname;

      // yi-hack expone diferentes endpoints RTSP, algunos con audio:
      const candidates = [
        `rtsp://${host}/ch0_0.h264`,       // estándar rRTSPServer
        `rtsp://${host}/ch0_1.h264`,       // stream secundario
        `rtsp://${host}:8554/ch0_0.h264`,  // rRTSPServer en puerto alternativo
        `rtsp://${host}/live/ch00_0`,      // otro formato yi-hack
        `rtsp://${host}/11`,               // formato simple
        `rtsp://${host}/12`,               // formato simple secundario
      ].filter((c) => c !== rtspUrl); // no probar la URL actual

      // Probar cada una vía go2rtc (sondeo rápido)
      const probeResults = await Promise.allSettled(
        candidates.map(async (candidateUrl) => {
          const probeName = `_probe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          try {
            // Registrar stream temporal
            const addRes = await fetch(
              `${env.GO2RTC_URL}/api/streams?src=${encodeURIComponent(candidateUrl)}&name=${encodeURIComponent(probeName)}`,
              { method: 'PUT', signal: AbortSignal.timeout(3000) },
            );
            if (!addRes.ok) return { url: candidateUrl, hasAudio: false, error: 'no se pudo registrar' };

            // Forzar conexión RTSP pidiendo el master m3u8 (respuesta corta,
            // se completa en servidor — ver nota anti-panic más arriba)
            try {
              const r = await fetch(
                `${env.GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(probeName)}`,
                { signal: AbortSignal.timeout(4000) },
              );
              await r.text().catch(() => undefined);
            } catch {
              // timeout esperado
            }

            // Esperar a que go2rtc negocie el SDP
            await new Promise((r) => setTimeout(r, 1500));

            // Consultar el stream
            const infoRes = await fetch(`${env.GO2RTC_URL}/api/streams`, {
              signal: AbortSignal.timeout(3000),
            });
            let probeHasAudio = false;
            if (infoRes.ok) {
              const allStreams: Record<string, Go2rtcStream> = await infoRes.json();
              const probeStream = allStreams[probeName];
              if (probeStream) {
                for (const producer of probeStream.producers ?? []) {
                  if (producer.sdp && /^m=audio/m.test(producer.sdp)) {
                    probeHasAudio = true;
                  }
                  if (producer.medias?.some((m: string) => m.startsWith('audio'))) {
                    probeHasAudio = true;
                  }
                }
              }
            }

            // Borrar stream temporal
            await fetch(
              `${env.GO2RTC_URL}/api/streams?src=${encodeURIComponent(candidateUrl)}&name=${encodeURIComponent(probeName)}`,
              { method: 'DELETE', signal: AbortSignal.timeout(2000) },
            ).catch(() => undefined);

            return { url: candidateUrl, hasAudio: probeHasAudio };
          } catch {
            return { url: candidateUrl, hasAudio: false, error: 'timeout o error de conexión' };
          }
        }),
      );

      alternativeUrls = probeResults
        .filter((r): r is PromiseFulfilledResult<{ url: string; hasAudio: boolean; error?: string }> => r.status === 'fulfilled')
        .map((r) => r.value);
    } catch {
      // No crítico
    }
  }

  // ── Diagnóstico ───────────────────────────────────────────────────────────
  if (!go2rtcReachable) {
    issues.push('go2rtc no está en ejecución o no es accesible');
  }
  if (!rtspUrl) {
    issues.push('No hay URL RTSP configurada para esta cámara');
  }
  if (go2rtcReachable && !streamExists) {
    issues.push('El stream no está registrado en go2rtc — abre la cámara para registrarlo');
  }
  if (streamExists && !streamActive) {
    issues.push('El stream está registrado pero go2rtc no está conectado a la cámara — puede que la cámara esté apagada o la URL RTSP sea incorrecta');
  }

  if (streamActive && !hasAudioTrack) {
    if (sdp && !sdpHasAudio) {
      issues.push('La cámara NO envía audio en el stream RTSP actual. El SDP solo contiene vídeo (m=video), no hay línea m=audio');
      suggestions.push('Accede a la interfaz web de la cámara (http://IP) → Configuración → yi-hack → Habilitar audio en RTSP');
      suggestions.push('Si ya está habilitado, reinicia la cámara para que el cambio surta efecto');
    } else {
      issues.push('No se detecta audio en el stream');
    }

    // Sugerir URL alternativa si encontramos una con audio
    const withAudio = alternativeUrls.find((a) => a.hasAudio);
    if (withAudio) {
      suggestions.push(`Se encontró audio en una URL alternativa: ${withAudio.url}`);
    } else {
      suggestions.push('El micrófono de la cámara puede estar desactivado en su configuración interna');
    }
  }

  return NextResponse.json({
    streamId,
    rtspUrl: rtspUrl ? rtspUrl.replace(/:[^@]+@/, ':***@') : null,
    go2rtcReachable,
    streamExists,
    streamActive,
    tracks,
    mediaLines,
    sdpHasVideo,
    sdpHasAudio,
    hasVideoTrack,
    hasAudioTrack,
    issues,
    suggestions,
    alternativeUrls: alternativeUrls.length > 0 ? alternativeUrls : undefined,
  });
}
