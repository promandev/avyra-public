'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Volume2,
  VolumeX,
  Volume1,
  Maximize2,
  Minimize2,
  AlertCircle,
  Loader2,
  Activity,
  Mic,
  Settings2,
  Check,
  Radio,
  Trash2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Download,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  CalendarDays,
  Film,
  Smartphone,
  Copy,
  Wifi,
  ExternalLink,
  User,
  PawPrint,
  Star,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Hls from 'hls.js';
import { updateCameraRtsp } from './actions';

interface RecordingSegment {
  startIso: string;
  durationSec: number;
  proxyUrl: string;
  motion: boolean;
  sound: boolean;
  /** Marcada como favorita en la APK del tablet (solo lectura desde Avyra). */
  favorite?: boolean;
}

interface RecordingEvent {
  startIso: string;
  endIso: string;
  durationSec: number;
  type: 'motion' | 'sound' | 'both' | 'recording';
  firstIndex: number;
  lastIndex: number;
}

/** Evento de movimiento simple (sin vídeo) guardado en BD — para tablets/IP Webcam. */
interface MotionEventEntry {
  id: string;
  occurredAt: string; // ISO 8601
  type: 'motion' | 'sound' | 'human' | 'animal';
  clipUrl?: string; // Avyra proxy URL to the event clip (tablet APK only)
}

interface CameraModalProps {
  cameraId: string;
  cameraName: string;
  isTablet?: boolean;
  tabletPaired?: boolean;
  tabletStatus?: string | null;
  tabletPairingData?: string | null;
  initialTimestamp?: string | null;
  onClose: () => void;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Envía al registro interno de cámaras (sólo lo ve el super admin) un fallo que
 * únicamente ve el navegador: un 524 del túnel, un ICE que no conecta, una
 * sesión HLS caducada… Nunca debe interferir con la reproducción.
 */
function reportCameraIssue(
  cameraId: string,
  issue: {
    level: 'error' | 'warn' | 'info';
    stage: 'webrtc' | 'hls' | 'player' | 'recordings';
    message: string;
    httpStatus?: number;
    detail?: Record<string, unknown>;
  },
) {
  try {
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    void fetch(`/api/cameras/${cameraId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        ...issue,
        detail: {
          ...issue.detail,
          online: navigator.onLine,
          ...(conn?.effectiveType && { net: conn.effectiveType }),
          hidden: document.visibilityState === 'hidden',
        },
      }),
    }).catch(() => undefined);
  } catch { /* nunca romper la reproducción por el registro */ }
}

function isoToMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Reloj de reproducción en minutos:segundos (ej. 3:07) a partir de segundos. */
function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Mini DatePicker ──────────────────────────────────────────────────────────

interface DatePickerProps {
  value: string; // YYYYMMDD
  onChange: (v: string) => void;
  maxDate?: Date;
}

function DatePicker({ value, onChange, maxDate }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const selYear = parseInt(value.slice(0, 4), 10);
  const selMonth = parseInt(value.slice(4, 6), 10) - 1;
  const selDay = parseInt(value.slice(6, 8), 10);

  const [viewYear, setViewYear] = useState(selYear);
  const [viewMonth, setViewMonth] = useState(selMonth);

  // Sync view when value changes externally
  useEffect(() => {
    setViewYear(parseInt(value.slice(0, 4), 10));
    setViewMonth(parseInt(value.slice(4, 6), 10) - 1);
  }, [value]);

  // Calculate portal position when opening — opens upward if not enough space below
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const POPUP_HEIGHT = 290; // approximate calendar height in px
      const spaceBelow = window.innerHeight - rect.bottom;
      const style: React.CSSProperties = {
        position: 'fixed',
        right: window.innerWidth - rect.right,
        zIndex: 9999,
      };
      if (spaceBelow >= POPUP_HEIGHT || spaceBelow >= rect.top) {
        style.top = rect.bottom + 4;
      } else {
        style.bottom = window.innerHeight - rect.top + 4;
      }
      setPopupStyle(style);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        popupRef.current && !popupRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const limit = maxDate ?? new Date();
  limit.setHours(23, 59, 59, 999);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // Monday-first: getDay() 0=Sun → offset = (day + 6) % 7
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const firstOffset = (firstDow + 6) % 7;

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const selDate = new Date(selYear, selMonth, selDay);
  const displayStr = selDate.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Mon-first weekday labels via Intl (Jan 1 2024 was a Monday)
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(
      new Date(2024, 0, 1 + i),
    ),
  );

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(viewYear, viewMonth, 1));

  function canGoNext() {
    return new Date(viewYear, viewMonth + 1, 1) <= limit;
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (!canGoNext()) return;
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  function selectDay(day: number) {
    const d = new Date(viewYear, viewMonth, day);
    if (d > limit) return;
    onChange(
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`,
    );
    setOpen(false);
  }

  return (
    <div ref={triggerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-accent transition"
      >
        <CalendarDays className="size-3 text-muted-foreground" />
        {displayStr}
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>

      {open && createPortal(
        <div ref={popupRef} style={popupStyle} className="w-64 rounded-xl border border-border bg-card p-3 shadow-xl">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="rounded p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs font-semibold capitalize">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              disabled={!canGoNext()}
              className="rounded p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {weekdayLabels.map((label, i) => (
              <div
                key={i}
                className="text-center text-[10px] font-medium text-muted-foreground py-1"
              >
                {label}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: firstOffset }, (_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const thisDate = new Date(viewYear, viewMonth, day);
              const isSel =
                viewYear === selYear && viewMonth === selMonth && day === selDay;
              const isToday =
                thisDate.getFullYear() === todayMidnight.getFullYear() &&
                thisDate.getMonth() === todayMidnight.getMonth() &&
                thisDate.getDate() === todayMidnight.getDate();
              const isDisabled = thisDate > limit;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => selectDay(day)}
                  className={[
                    'relative flex items-center justify-center rounded-md text-xs py-1.5 transition select-none',
                    isDisabled
                      ? 'opacity-25 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-accent',
                    isSel
                      ? 'bg-primary text-primary-foreground hover:bg-primary font-semibold'
                      : isToday
                        ? 'text-primary font-semibold'
                        : '',
                  ].join(' ')}
                >
                  {day}
                  {isToday && !isSel && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function CameraModal({ cameraId, cameraName, isTablet, tabletPaired, tabletStatus, tabletPairingData, initialTimestamp, onClose }: CameraModalProps) {
  const t = useTranslations('cameras');
  const tc = useTranslations('common');
  const tRef = useRef(t);
  tRef.current = t;
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  // Watchdog WebRTC→HLS: si no hay frames reales, cae a HLS.
  const webrtcWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Watchdog HLS→error: si HLS no renderiza frames, muestra error.
  const hlsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reintentos automáticos del directo HLS antes de mostrar el error. Se
  // reinician en cuanto hay imagen real (ver watcher de frames).
  const hlsRetriesRef = useRef(0);
  const hlsRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHlsRef = useRef<() => void>(() => undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(true); // inicia muted para autoplay fiable
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [streamMode, setStreamMode] = useState<'webrtc' | 'hls' | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Snapshot de fondo: se carga al abrir el modal y se usa como fondo
  // mientras conecta o si hay error (en lugar de negro puro).
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

  // Barra de tiempo: minutos del día (0-1439)
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [events, setEvents] = useState<RecordingEvent[]>([]);
  const [motionEvents, setMotionEvents] = useState<MotionEventEntry[]>([]);
  const [motionActive, setMotionActive] = useState(false);
  const [soundActive, setSoundActive] = useState(false);
  /** Grabaciones de IP Webcam (modet), usadas para botones de play en la lista de detecciones */
  const [ipWebcamSegs, setIpWebcamSegs] = useState<(RecordingSegment & { mtimeMs: number })[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    if (initialTimestamp) {
      try {
        return new Date(initialTimestamp).toISOString().slice(0, 10).replace(/-/g, '');
      } catch { /* fallback */ }
    }
    return todayStr();
  });
  const autoPlayedRef = useRef(false);
  const [playingSegment, setPlayingSegment] = useState<RecordingSegment | null>(null);
  const [playingIndex, setPlayingIndex] = useState(-1);

  // ── Controles de reproducción (pausa + scrub minuto/segundo) ───────────────
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);

  // ── Diagnóstico de audio ──────────────────────────────────────────────────
  const [audioDiag, setAudioDiag] = useState<{
    hasAudioTrack: boolean;
    hasVideoTrack: boolean;
    streamActive: boolean;
    sdpHasAudio: boolean;
    issues: string[];
    suggestions: string[];
    tracks: { codec: string; type: string; profile?: string }[];
    mediaLines: string[];
    alternativeUrls?: { url: string; hasAudio: boolean; error?: string }[];
  } | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [loadingDiag, setLoadingDiag] = useState(false);

  // ── Borrado de SD ─────────────────────────────────────────────────────────
  const [clearingSD, setClearingSD] = useState(false);
  const [clearSDResult, setClearSDResult] = useState<'success' | 'error' | null>(null);

  // ── Estado para expandir eventos ────────────────────────────────────────
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  /** Por qué no hay listado: antes un fallo se mostraba como "sin grabaciones". */
  const [recordingsError, setRecordingsError] = useState<'unreachable' | 'failed' | null>(null);
  const [recordingsPartial, setRecordingsPartial] = useState(false);
  const [recordingsReload, setRecordingsReload] = useState(0);

  // ── Filtro de eventos (motion/sound/both) ─────────────────────────────────
  const [eventFilter, setEventFilter] = useState<'all' | 'motion' | 'sound' | 'human' | 'animal'>('all');

  // ── Borrado individual de motion events ───────────────────────────────────
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  // ── Estado para formulario RTSP inline ────────────────────────────────────
  const [errorType, setErrorType] = useState<'no_rtsp' | 'no_go2rtc' | 'no_stream_active' | 'other' | null>(null);
  const [showRtspForm, setShowRtspForm] = useState(false);
  const [rtspInput, setRtspInput] = useState('');
  const [savingRtsp, setSavingRtsp] = useState(false);
  const [rtspSaved, setRtspSaved] = useState(false);

  // ── Estado para tablet agent ──────────────────────────────────────────────
  const [tabletActivating, setTabletActivating] = useState(false);
  const [pairingCopied, setPairingCopied] = useState(false);

  // ── Pantalla completa ─────────────────────────────────────────────────────
  // nativeFullscreen: Fullscreen API (Android/desktop) + orientation.lock.
  // pseudoFullscreen: fallback iOS Safari (no soporta requestFullscreen en
  // divs) — overlay fijo; si el dispositivo está en vertical se rota el
  // contenido 90° vía CSS (cssRotate) para simular el modo apaisado.
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [cssRotate, setCssRotate] = useState(false);
  const isFullscreen = nativeFullscreen || pseudoFullscreen;

  // Ref ESTABLE para el <video>: React solo la invoca al montar/desmontar el
  // elemento. La versión anterior era una arrow inline (identidad nueva en cada
  // render), así que React la re-ejecutaba en CADA render y su `el.muted = true`
  // volvía a silenciar el vídeo justo después de que el usuario activara el
  // sonido (cualquier setState —p.ej. el reloj de reproducción— re-muteaba).
  const attachVideoRef = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (el) el.muted = true; // arrancar muted para permitir autoplay (solo al montar)
  }, []);

  const sendTabletCommand = useCallback(async (action: 'start' | 'stop') => {
    setTabletActivating(true);
    try {
      await fetch(`/api/cameras/${cameraId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } finally {
      setTabletActivating(false);
    }
  }, [cameraId]);

  // ── Teardown WebRTC, HLS y MJPEG ────────────────────────────────────────
  const closePC = useCallback(() => {
    if (webrtcWatchdogRef.current) {
      clearTimeout(webrtcWatchdogRef.current);
      webrtcWatchdogRef.current = null;
    }
    if (hlsWatchdogRef.current) {
      clearTimeout(hlsWatchdogRef.current);
      hlsWatchdogRef.current = null;
    }
    if (hlsRetryTimerRef.current) {
      clearTimeout(hlsRetryTimerRef.current);
      hlsRetryTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
      video.removeAttribute('src');
    }
    // Stop any active MJPEG stream (tablet live view)
    if (isTablet) {
      const img = imgRef.current;
      if (img) img.src = '';
    }
    setStreamMode(null);
  }, [isTablet]);

  // ── Fallback HLS cuando WebRTC no puede establecerse ─────────────────────
  // Usa el proxy /api/cameras/[id]/stream que proxifica go2rtc HLS internamente,
  // por lo que funciona desde cualquier red (LAN o exterior vía Cloudflare).
  const startHlsStream = useCallback(() => {
    if (hlsRef.current) return; // Ya hay una instancia HLS activa
    const video = videoRef.current;
    if (!video) return;
    setStreamReady(false);
    setStreamError(null);
    setErrorType(null);
    setStreamMode('hls');

    const hlsUrl = `/api/cameras/${cameraId}/stream`;

    // streamReady NO se marca aquí: lo hace el watcher de frames reales
    // (videoWidth>0). Así el spinner permanece hasta que hay imagen de verdad.
    // `httpStatus` (si se conoce) concreta el motivo del fallo en el mensaje —
    // clave para diagnosticar fallos desde redes externas.
    //
    // Los fallos suelen ser pasajeros: el 404 típico es la sesión HLS de go2rtc
    // caducada (muere a los ~6 s sin descargar segmentos: red lenta, pestaña
    // en segundo plano, móvil que cambia de antena). Una sesión nueva lo
    // arregla, así que antes de mostrar el error se reintenta desde cero.
    const MAX_RETRIES = 3;
    let failed = false;
    const fail = (httpStatus?: number, reason?: string) => {
      if (failed) return;
      failed = true;
      if (hlsWatchdogRef.current) {
        clearTimeout(hlsWatchdogRef.current);
        hlsWatchdogRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const attempt = hlsRetriesRef.current + 1;
      const willRetry = attempt <= MAX_RETRIES;
      reportCameraIssue(cameraId, {
        level: willRetry ? 'warn' : 'error',
        stage: 'hls',
        httpStatus,
        message: `${reason ?? 'Fallo del reproductor HLS'}${willRetry ? ` — reintento ${attempt}/${MAX_RETRIES}` : ' — se muestra error al usuario'}`,
        detail: { hadFrames: video.videoWidth > 0 },
      });
      setStreamReady(false);
      if (willRetry) {
        hlsRetriesRef.current = attempt;
        hlsRetryTimerRef.current = setTimeout(() => {
          hlsRetryTimerRef.current = null;
          video.removeAttribute('src');
          startHlsRef.current();
        }, 1500 * attempt);
        return;
      }
      setStreamMode(null);
      setErrorType('other');
      setStreamError(
        httpStatus
          ? tRef.current('httpError', { status: httpStatus })
          : tRef.current('connectionError'),
      );
    };

    // Watchdog: si en 25 s no hay frames renderizados, mostrar error en vez de
    // dejar un spinner infinito o una pantalla en negro.
    if (hlsWatchdogRef.current) clearTimeout(hlsWatchdogRef.current);
    hlsWatchdogRef.current = setTimeout(() => {
      if (!video.videoWidth) fail(undefined, 'Sin imagen tras 25 s de HLS');
    }, 25_000);

    if (Hls.isSupported()) {
      // Timeouts generosos: el master playlist puede tardar hasta ~14 s en frío
      // (la ruta reintenta mientras ffmpeg arranca) y el default de hls.js son
      // 10 s → abortaba con error fatal SIN código HTTP desde redes externas.
      const hls = new Hls({
        lowLatencyMode: false,
        manifestLoadingTimeOut: 30_000,
        manifestLoadingMaxRetry: 2,
        levelLoadingTimeOut: 20_000,
        fragLoadingTimeOut: 30_000,
        // Nunca saltar hacia el directo ni acelerar: el colchón de abajo es
        // retraso buscado, no un atraso que corregir.
        liveMaxLatencyDurationCount: Infinity,
        maxLiveSyncPlaybackRate: 1,
      });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      // Colchón de buffer. El HLS de go2rtc no es HLS "de verdad": cada
      // segmento es lo acumulado desde la petición anterior (anuncia 0,5 s
      // pero trae lo que haya) y el playlist solo lista 2. Arrancar en cuanto
      // llega el primero deja ~0,5 s de margen, y cualquier tirón de la red
      // móvil o del túnel congela la imagen → directo entrecortado. Se espera
      // a tener unos segundos en buffer antes de reproducir, y si se vacía se
      // pausa hasta recuperarlo (a costa de ~3 s de retraso).
      const START_CUSHION_S = 3;
      const REBUFFER_CUSHION_S = 2;
      let cushion = START_CUSHION_S;
      let waitingForCushion = true;
      const bufferedAhead = () => {
        const b = video.buffered;
        for (let i = 0; i < b.length; i++) {
          if (video.currentTime >= b.start(i) - 0.5 && video.currentTime <= b.end(i)) {
            return b.end(i) - Math.max(video.currentTime, b.start(i));
          }
        }
        return b.length ? b.end(b.length - 1) - b.start(b.length - 1) : 0;
      };
      const resume = () => {
        waitingForCushion = false;
        video.play().catch(() => {
          // iOS puede negar play() sin gesto tras una pausa con sonido: mejor
          // seguir sin audio (el aviso "toca para activar" reaparece) que
          // quedarse congelado.
          video.muted = true;
          setMuted(true);
          video.play().catch(() => undefined);
        });
      };
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (waitingForCushion && bufferedAhead() >= cushion) resume();
      });
      const onWaiting = () => {
        if (!hlsRef.current || hlsRef.current !== hls || waitingForCushion) return;
        waitingForCushion = true;
        cushion = REBUFFER_CUSHION_S;
        video.pause();
      };
      video.addEventListener('waiting', onWaiting);
      hls.on(Hls.Events.DESTROYING, () => video.removeEventListener('waiting', onWaiting));

      // go2rtc incluye el AAC de la cámara en el HLS, pero hasAudioTrack solo
      // lo marcaba el ontrack de WebRTC: en HLS la UI decía "sin audio" y no
      // ofrecía activarlo aunque el sonido llegaba.
      hls.on(Hls.Events.BUFFER_CODECS, (_ev: unknown, data: { audio?: unknown }) => {
        if (data.audio) setHasAudioTrack(true);
      });
      let mediaRecoveries = 0;
      hls.on(Hls.Events.ERROR, (_ev: unknown, data: { fatal: boolean; type?: string; details?: string; response?: { code?: number } }) => {
        if (!data.fatal) return;
        // Error de decodificación: hls.js sabe recuperarse sin sesión nueva.
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
          mediaRecoveries++;
          reportCameraIssue(cameraId, {
            level: 'warn',
            stage: 'player',
            message: `Error de decodificación (${data.details ?? '?'}) — recuperando`,
          });
          hls.recoverMediaError();
          return;
        }
        // code 0 = la petición no llegó a responder (red caída, CORS, 524
        // cortado por el túnel antes de cabeceras…).
        const code = data.response?.code || undefined;
        fail(code, `hls.js ${data.type ?? ''}/${data.details ?? ''}`);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari: HLS nativo
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => {
        const tracks = (video as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
        if (!tracks || tracks.length > 0) setHasAudioTrack(true);
        video.play().catch(() => undefined);
      }, { once: true });
      video.addEventListener('error', () => {
        const err = video.error;
        fail(undefined, `Safari HLS nativo: código ${err?.code ?? '?'} ${err?.message ?? ''}`.trim());
      }, { once: true });
    } else {
      setStreamMode(null);
      setErrorType('no_go2rtc');
      setStreamError(tRef.current('noGo2rtc'));
    }
  }, [cameraId]);
  startHlsRef.current = startHlsStream;

  // ── Inicializar stream en directo (MJPEG para tablets, WebRTC para el resto) ──
  const initLiveStream = useCallback(async () => {
    closePC();
    hlsRetriesRef.current = 0;
    setStreamError(null);
    setErrorType(null);
    setStreamReady(false);

    // Tablet cameras: use MJPEG stream directly — no WebRTC/go2rtc needed.
    if (isTablet) {
      const img = imgRef.current;
      if (img) {
        img.src = `/api/cameras/${cameraId}/live-stream?t=${Date.now()}`;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pcRef.current = pc;

    // Watchdog: WebRTC negocia el SDP correctamente vía HTTPS aunque ICE no
    // conecte (p.ej. fuera de la LAN, donde 192.168.x:8555 es inalcanzable).
    // En ese caso `ontrack` se dispara pero NUNCA llega vídeo → pantalla negra.
    // Por eso NO usamos la llegada del track como señal de éxito: a los 10 s
    // comprobamos si hay frames reales (videoWidth>0) y, si no, caemos a HLS.
    if (webrtcWatchdogRef.current) clearTimeout(webrtcWatchdogRef.current);
    webrtcWatchdogRef.current = setTimeout(() => {
      if (pcRef.current !== pc) return;
      const v = videoRef.current;
      if (v && v.videoWidth > 0) return; // WebRTC sí está renderizando vídeo
      // Esperado fuera de la LAN (el ICE sólo anuncia la IP privada): info.
      reportCameraIssue(cameraId, {
        level: 'info',
        stage: 'webrtc',
        message: `WebRTC sin imagen en 10 s (ICE ${pc.iceConnectionState}) → se pasa a HLS`,
      });
      closePC();
      startHlsStream();
    }, 10_000);

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // Función auxiliar para (re)intentar play cuando llega un track de vídeo.
    // Con ffmpeg:#audio=opus, go2rtc suele enviar primero el track de audio
    // Opus (está listo antes). Cuando video.srcObject se asigna solo con audio,
    // Chrome puede pausar el elemento. Al llegar el track de vídeo debemos
    // volver a llamar a play() para que el navegador renderice ambos.
    const tryPlay = () => {
      video.play().catch(() => undefined);
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        setHasAudioTrack(true);
      }
      if (event.track.kind === 'video') {
        setHasVideoTrack(true);
      }

      // NOTA: la llegada del track NO marca streamReady ni cancela el watchdog.
      // `ontrack` se dispara en la negociación SDP, antes de que ICE conecte y
      // de que llegue vídeo. streamReady lo marca el watcher de frames reales.
      const stream = event.streams[0];
      if (stream) {
        if (video.srcObject !== stream) {
          video.srcObject = stream;
        }
        tryPlay();
      } else if (!(video.srcObject instanceof MediaStream)) {
        video.srcObject = new MediaStream([event.track]);
        tryPlay();
      } else {
        (video.srcObject as MediaStream).addTrack(event.track);
        tryPlay();
      }
    };

    // connectionstatechange: re-play si se recupera; fallback HLS si ICE falla
    // (fallo ICE ocurre p.ej. cuando el browser está fuera de la LAN y no puede
    // alcanzar 192.168.1.x:8555 directamente).
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && video.paused) {
        tryPlay();
      }
      if (pc.connectionState === 'failed') {
        if (pcRef.current !== pc) return;
        const hadFrames = video.videoWidth > 0;
        reportCameraIssue(cameraId, {
          level: hadFrames ? 'warn' : 'info',
          stage: 'webrtc',
          message: hadFrames
            ? 'Conexión WebRTC perdida en pleno directo → se pasa a HLS'
            : 'ICE de WebRTC falló → se pasa a HLS',
        });
        closePC();
        startHlsStream();
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Esperar a que ICE gathering termine (máx. 3 s)
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const check = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', check);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', check);
        setTimeout(resolve, 3000);
      });

      // Guardia: abortar si este PC ya no es el activo (React Strict Mode
      // desmonta y remonta efectos en desarrollo, lo que cierra el PC antes
      // de que la cadena async termine).
      if (pcRef.current !== pc) return;

      const res = await fetch(`/api/cameras/${cameraId}/webrtc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription!.sdp,
      });

      // Guardia: verificar de nuevo tras la petición de red
      if (pcRef.current !== pc) return;

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        closePC();
        if (text === 'NO_RTSP_URL' || res.status === 422) {
          setErrorType('no_rtsp');
          setStreamError(tRef.current('noRtsp'));
        } else if (text === 'NO_STREAM_ACTIVE' || res.status === 409) {
          setErrorType('no_stream_active');
          setStreamError(tRef.current('noStreamActive'));
        } else {
          // go2rtc no disponible o error transitorio → intentar HLS automáticamente
          reportCameraIssue(cameraId, {
            level: 'warn',
            stage: 'webrtc',
            httpStatus: res.status,
            message: `Señalización WebRTC falló (${text.slice(0, 120) || 'sin cuerpo'}) → se pasa a HLS`,
          });
          startHlsStream();
        }
        return;
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // Fuera de la LAN el único candidato de go2rtc es la IP privada: ICE se
      // queda en "checking" para siempre. En la LAN conecta en <1 s tras la
      // respuesta, así que si a los 4 s no hay ICE, no esperar los 10 s del
      // watchdog con la pantalla en negro.
      setTimeout(() => {
        if (pcRef.current !== pc) return;
        const ice = pc.iceConnectionState;
        if (ice === 'connected' || ice === 'completed' || video.videoWidth > 0) return;
        reportCameraIssue(cameraId, {
          level: 'info',
          stage: 'webrtc',
          message: `ICE sin conectar 4 s después de la respuesta (ICE ${ice}) → se pasa a HLS`,
        });
        closePC();
        startHlsStream();
      }, 4_000);
    } catch (err) {
      if (pcRef.current !== pc) return;
      reportCameraIssue(cameraId, {
        level: 'warn',
        stage: 'webrtc',
        message: `Error en la negociación WebRTC: ${err instanceof Error ? err.message : String(err)} → se pasa a HLS`,
      });
      closePC();
      startHlsStream();
    }
  }, [cameraId, closePC, isTablet, startHlsStream]);

  // ── Guardar URL RTSP y reintentar ─────────────────────────────────────────
  const saveRtspAndRetry = useCallback(async () => {
    if (!rtspInput) return;
    setSavingRtsp(true);
    const result = await updateCameraRtsp(cameraId, rtspInput);
    setSavingRtsp(false);
    if (result.error) {
      setStreamError(result.error);
      return;
    }
    setRtspSaved(true);
    setShowRtspForm(false);
    setTimeout(() => {
      setRtspSaved(false);
      initLiveStream();
    }, 800);
  }, [cameraId, rtspInput, initLiveStream]);

  // ── Reproducir segmento grabado ────────────────────────────────────────────
  const playSegment = useCallback(
    (seg: RecordingSegment, index?: number) => {
      const video = videoRef.current;
      if (!video) return;

      closePC();
      setIsLive(false);
      setPlayingSegment(seg);
      setPlayingIndex(index ?? segments.indexOf(seg));
      setStreamError(null);
      setErrorType(null);
      setStreamReady(false);

      // Sembrar la duración con el valor que ya conoce el servidor (calculado a
      // partir de startTs/endTs de la APK). Los MP4 de MediaRecorder reportan
      // video.duration === Infinity hasta que se fuerza el cálculo, así que sin
      // esto la barra de reproducción se queda clavada en 0 y no se puede ni
      // arrastrar ni saltar. Ver onDur más abajo, que ya no la pisa con 0.
      setPlaybackTime(0);
      setPlaybackDuration(seg.durationSec > 0 ? seg.durationSec : 0);

      video.srcObject = null;
      video.src = seg.proxyUrl;
      video.load();
      // Forzar el cálculo de la duración real cuando el MP4 la reporta como
      // Infinity (típico de grabaciones de Android): saltar más allá del final
      // hace que el navegador indexe el fichero y exponga duración + seekable.
      // Auto-reparable: si la fuente no soporta Range el salto se quedaría
      // colgado, así que un timeout vuelve a 0 para no romper la reproducción.
      video.addEventListener('loadedmetadata', function onMeta() {
        if (Number.isFinite(video.duration)) return;
        let done = false;
        const reset = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('durationchange', onSeeked);
          video.currentTime = 0;
        };
        const onSeeked = () => { if (Number.isFinite(video.duration)) reset(); };
        const timer = setTimeout(reset, 3000);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('durationchange', onSeeked);
        try {
          video.currentTime = 1e7;
        } catch {
          reset();
        }
      }, { once: true });
      video.addEventListener('canplay', () => {
        setStreamReady(true);
        video.play().catch(() => undefined);
      }, { once: true });
      video.addEventListener('error', () =>
        setStreamError(tRef.current('loadFragmentError')),
        { once: true },
      );
    },
    [closePC, segments],
  );

  // ── Reproducción continua: avanzar al siguiente segmento ──────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isLive) return;

    const handleEnded = () => {
      const nextIdx = playingIndex + 1;
      const next = segments[nextIdx];
      if (next) {
        playSegment(next, nextIdx);
      }
    };

    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, [isLive, playingIndex, segments, playSegment]);

  const backToLive = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load(); // reset to empty state (fires 'emptied', not 'error')
    }
    setIsLive(true);
    setPlayingSegment(null);
    initLiveStream();
  }, [initLiveStream]);

  // ── Sincronizar la barra de reproducción con el elemento <video> ──────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setPlaybackTime(video.currentTime);
    // Solo actualizar con la duración del navegador cuando es válida; si es
    // Infinity/NaN conservamos la duración sembrada desde el servidor.
    const onDur = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) setPlaybackDuration(d);
    };
    const onPlay = () => setPlaybackPaused(false);
    const onPause = () => setPlaybackPaused(true);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDur);
    video.addEventListener('loadedmetadata', onDur);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onDur);
      video.removeEventListener('loadedmetadata', onDur);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  // ── Play/pausa y salto a minuto/segundo concretos en la grabación ─────────
  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    // Preferir la duración real del navegador; si es Infinity/NaN, usar la
    // duración conocida del servidor (playbackDuration sembrada) para acotar.
    const max = Number.isFinite(video.duration)
      ? video.duration
      : (playbackDuration > 0 ? playbackDuration : time);
    const clamped = Math.max(0, Math.min(time, max));
    video.currentTime = clamped;
    setPlaybackTime(clamped);
  }, [playbackDuration]);

  // ── Descargar grabación al dispositivo ────────────────────────────────────
  // El proxyUrl es del mismo origen; pasamos dl=1 para que la API responda con
  // Content-Disposition: attachment (necesario en móvil, donde el atributo
  // `download` del <a> se suele ignorar) y un nombre legible.
  const downloadSegment = useCallback((seg: RecordingSegment) => {
    const d = new Date(seg.startIso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const safeName = cameraName.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
    const filename = `${safeName || 'camara'}_${stamp}.mp4`;
    const sep = seg.proxyUrl.includes('?') ? '&' : '?';
    const url = `${seg.proxyUrl}${sep}dl=1&name=${encodeURIComponent(filename)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [cameraName]);

  // ── Borrar memoria SD ─────────────────────────────────────────────────────
  const clearSD = useCallback(async () => {
    if (!confirm(tRef.current('clearSdConfirm'))) return;
    setClearingSD(true);
    setClearSDResult(null);
    try {
      const res = await fetch(`/api/cameras/${cameraId}/recordings/clear`, { method: 'DELETE' });
      if (res.ok) {
        setClearSDResult('success');
        setSegments([]);
        setEvents([]);
        setMotionEvents([]);
        setMotionActive(false);
        setSoundActive(false);
        setIpWebcamSegs([]);
        setExpandedEvent(null);
      } else {
        setClearSDResult('error');
      }
    } catch {
      setClearSDResult('error');
    }
    setClearingSD(false);
    setTimeout(() => setClearSDResult(null), 4000);
  }, [cameraId]);

  // ── Borrar evento individual de BD ────────────────────────────────────────
  const deleteMotionEvent = useCallback(async (eventId: string) => {
    setDeletingEventId(eventId);
    try {
      await fetch(`/api/cameras/${cameraId}/motion-events?eventId=${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });
      setMotionEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch {
      // ignore
    } finally {
      setDeletingEventId(null);
    }
  }, [cameraId]);

  // ── Cargar diagnóstico de audio ───────────────────────────────────────────
  const loadDiag = useCallback(async () => {
    setLoadingDiag(true);
    try {
      const res = await fetch(`/api/cameras/${cameraId}/diag`);
      if (res.ok) {
        const data = await res.json();
        setAudioDiag(data);
        setShowDiag(true);
      }
    } catch { /* ignore */ }
    setLoadingDiag(false);
  }, [cameraId]);

  // ── Montar ────────────────────────────────────────────────────────────────
  useEffect(() => {
    initLiveStream();
    return () => { closePC(); };
  }, [initLiveStream, closePC]);

  // ── Watcher de frames reales (fuente de verdad de streamReady) ────────────
  // Tanto WebRTC como HLS usan el mismo <video>. streamReady (y por tanto el
  // ocultado del spinner) solo se activa cuando el vídeo tiene dimensiones
  // (videoWidth>0) y la reproducción avanza — es decir, cuando hay IMAGEN real,
  // no una pantalla en negro. También cancela los watchdogs de fallback/error.
  useEffect(() => {
    if (isTablet) return; // tablet usa <img> con su propio onLoad
    const video = videoRef.current;
    if (!video) return;
    const onFrames = () => {
      if (video.videoWidth > 0 && !video.paused) {
        setStreamReady(true);
        hlsRetriesRef.current = 0;
        if (webrtcWatchdogRef.current) {
          clearTimeout(webrtcWatchdogRef.current);
          webrtcWatchdogRef.current = null;
        }
        if (hlsWatchdogRef.current) {
          clearTimeout(hlsWatchdogRef.current);
          hlsWatchdogRef.current = null;
        }
      }
    };
    video.addEventListener('timeupdate', onFrames);
    video.addEventListener('playing', onFrames);
    video.addEventListener('loadeddata', onFrames);
    return () => {
      video.removeEventListener('timeupdate', onFrames);
      video.removeEventListener('playing', onFrames);
      video.removeEventListener('loadeddata', onFrames);
    };
  }, [isTablet]);

  // ── Cargar snapshot de fondo al montar ────────────────────────────────────
  useEffect(() => {
    const img = new Image();
    const url = `/api/cameras/${cameraId}/snapshot?t=${Date.now()}`;
    img.onload = () => setSnapshotUrl(url);
    img.onerror = () => setSnapshotUrl(null);
    img.src = url;
  }, [cameraId]);

  // ── Cargar segmentos de grabación ─────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    setSegments([]);
    setEvents([]);
    setMotionEvents([]);
    setMotionActive(false);
    setSoundActive(false);
    setIpWebcamSegs([]);
    setExpandedEvent(null);
    setLoadingRecordings(true);
    setRecordingsError(null);
    setRecordingsPartial(false);

    type RecordingsResponse = {
      segments: RecordingSegment[];
      events: RecordingEvent[];
      unreachable?: boolean;
      partial?: boolean;
      failedHours?: string[];
    };

    // Un fallo pasajero (la cámara ocupada, un 524 del túnel, la red del móvil)
    // se reintenta una vez sola antes de dar el listado por perdido. Antes
    // `r.json()` sobre una respuesta de error lanzaba y la lista se quedaba
    // vacía, indistinguible de "no hay grabaciones".
    let lastKind: 'unreachable' | 'failed' = 'failed';
    const load = async (attempt: number): Promise<RecordingsResponse | null> => {
      const t0 = Date.now();
      let problem: { status?: number; message: string };
      lastKind = 'failed';
      try {
        const r = await fetch(`/api/cameras/${cameraId}/recordings?date=${selectedDate}`, {
          signal: ctrl.signal,
        });
        if (r.ok) {
          const data = (await r.json()) as RecordingsResponse;
          if (!data.unreachable) return data;
          lastKind = 'unreachable';
          problem = { message: 'El servidor no pudo contactar con la cámara' };
        } else {
          problem = {
            status: r.status,
            message: r.status === 524
              ? 'Cloudflare cortó la petición por tiempo (524)'
              : `Respuesta HTTP ${r.status}`,
          };
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        problem = { message: `Error de red: ${(err as Error).message}` };
      }
      const retry = attempt === 0;
      reportCameraIssue(cameraId, {
        level: retry ? 'warn' : 'error',
        stage: 'recordings',
        httpStatus: problem.status,
        message: `Listado de grabaciones: ${problem.message}${retry ? ' — reintentando' : ''}`,
        detail: { date: selectedDate, elapsedMs: Date.now() - t0 },
      });
      if (!retry) return null;
      await new Promise((res) => setTimeout(res, 2500));
      if (ctrl.signal.aborted) throw new DOMException('aborted', 'AbortError');
      return load(1);
    };

    load(0)
      .then((result) => {
        // Sin listado de la SD, las detecciones guardadas en BD siguen
        // cargándose abajo: no dependen de la cámara.
        if (!result) setRecordingsError(lastKind);
        const data: RecordingsResponse = result ?? { segments: [], events: [] };
        const segs = data.segments ?? [];
        const evts = data.events ?? [];
        setSegments(segs);
        setEvents(evts);
        setRecordingsPartial(!!data.partial);
        setLoadingRecordings(false);
        if (isTablet) {
          // Tablet: cargar eventos BD + grabaciones IP Webcam solo si no hay grabaciones SD
          if (segs.length === 0) {
            Promise.all([
              fetch(`/api/cameras/${cameraId}/motion-events?date=${selectedDate}`, { signal: ctrl.signal })
                .then((r) => r.ok ? r.json() : { events: [] })
                .catch(() => ({ events: [] })),
              fetch(`/api/cameras/${cameraId}/ipwebcam-recordings?date=${selectedDate}`, { signal: ctrl.signal })
                .then((r) => r.ok ? r.json() : { segments: [] })
                .catch(() => ({ segments: [] })),
            ]).then(([evtData, recData]: [{ events: MotionEventEntry[] }, { segments: (RecordingSegment & { mtimeMs: number })[] }]) => {
              setMotionEvents(evtData.events ?? []);
              const apiSegs = recData.segments ?? [];
              setIpWebcamSegs(apiSegs);
              if (apiSegs.length > 0) setSegments(apiSegs);
            }).catch(() => undefined);
          }
        } else {
          // Cámara normal: cargar siempre eventos de BD (independientemente de si hay grabaciones SD)
          fetch(`/api/cameras/${cameraId}/motion-events?date=${selectedDate}`, { signal: ctrl.signal })
            .then((r) => r.ok ? r.json() : { events: [] })
            .then((evtData: { events: MotionEventEntry[] }) => setMotionEvents(evtData.events ?? []))
            .catch(() => undefined);
        }
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') {
          setLoadingRecordings(false);
        }
      });
    return () => ctrl.abort();
  }, [cameraId, selectedDate, recordingsReload]);

  // ── Auto-reproducir el segmento más cercano al initialTimestamp ───────────
  useEffect(() => {
    if (!initialTimestamp || autoPlayedRef.current || segments.length === 0) return;
    const targetMs = new Date(initialTimestamp).getTime();
    let bestSeg: RecordingSegment | null = null;
    let bestIdx = -1;
    let bestDiff = Infinity;
    segments.forEach((seg, i) => {
      const segStart = new Date(seg.startIso).getTime();
      const segEnd = segStart + seg.durationSec * 1000;
      // Preferir el segmento que contiene el timestamp (con tolerancia de 60s)
      if (targetMs >= segStart - 60_000 && targetMs <= segEnd + 60_000) {
        const diff = Math.abs(targetMs - segStart);
        if (diff < bestDiff) { bestDiff = diff; bestSeg = seg; bestIdx = i; }
      }
    });
    if (!bestSeg) {
      // Fallback: segmento más cercano por tiempo de inicio
      segments.forEach((seg, i) => {
        const diff = Math.abs(new Date(seg.startIso).getTime() - targetMs);
        if (diff < bestDiff) { bestDiff = diff; bestSeg = seg; bestIdx = i; }
      });
    }
    if (bestSeg) {
      autoPlayedRef.current = true;
      playSegment(bestSeg, bestIdx);
    }
  }, [segments, initialTimestamp, playSegment]);

  // ── Polling de movimiento en vivo (para cámaras sin SD, ej. tablet) ───────
  // Sólo activo si no hay segmentos grabados y se está viendo el día de hoy
  useEffect(() => {
    if (segments.length > 0 || selectedDate !== todayStr()) return;

    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/cameras/${cameraId}/motion-poll`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          motionActive: boolean;
          soundActive: boolean;
          newEvents: MotionEventEntry[];
        };
        if (!cancelled) {
          setMotionActive(data.motionActive);
          setSoundActive(data.soundActive);
          if (data.newEvents.length > 0) {
            setMotionEvents((prev) => {
              const existingKeys = new Set(prev.map((e) => `${e.occurredAt}-${e.type}`));
              const fresh = data.newEvents.filter((e) => !existingKeys.has(`${e.occurredAt}-${e.type}`));
              return fresh.length > 0 ? [...prev, ...fresh] : prev;
            });
          }
        }
      } catch {
        // red unavailable, ignore
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cameraId, segments.length, selectedDate]);

  // ── Controles de volumen ──────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = muted ? 0 : volume;
    video.muted = muted;
    // Cuando el usuario desmutea (gesto), re-intentar play si estaba pausado
    if (!muted && video.paused && (video.srcObject || video.src)) {
      video.play().catch(() => undefined);
    }
  }, [volume, muted]);

  // ── Progreso de carga del stream ─────────────────────────────────────────
  useEffect(() => {
    if (streamReady) {
      setLoadingProgress(100);
      return;
    }
    if (streamError) return;
    setLoadingProgress(0);
    const id = setInterval(() => {
      setLoadingProgress((p) => {
        if (p >= 95) return p;
        return p + Math.max(0.3, (95 - p) / 12);
      });
    }, 100);
    return () => clearInterval(id);
  }, [streamReady, streamError]);

  // ── Pantalla completa ─────────────────────────────────────────────────────
  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      // unlock() lanza si nunca se llegó a bloquear — ignorar
      try { (screen.orientation as unknown as { unlock?: () => void }).unlock?.(); } catch { /* ignore */ }
      document.exitFullscreen().catch(() => undefined);
    }
    setPseudoFullscreen(false);
    setCssRotate(false);
  }, []);

  const enterFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;
    if (el?.requestFullscreen) {
      try {
        await el.requestFullscreen();
        // Forzar apaisado en móvil (falla silenciosamente en escritorio, donde
        // lock() no está permitido/disponible — el fullscreen normal ya vale)
        try {
          await (screen.orientation as unknown as {
            lock?: (o: string) => Promise<void>;
          }).lock?.('landscape');
        } catch { /* escritorio o lock no soportado */ }
        return;
      } catch { /* caer al modo pseudo */ }
    }
    // iOS Safari: sin Fullscreen API sobre divs → overlay + rotación CSS
    setPseudoFullscreen(true);
    setCssRotate(isPortrait);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) exitFullscreen();
    else void enterFullscreen();
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // Sincronizar estado con la Fullscreen API (el usuario puede salir con ESC,
  // gesto de retroceso, etc. sin pasar por nuestro botón).
  useEffect(() => {
    const onChange = () => {
      const active = !!document.fullscreenElement;
      setNativeFullscreen(active);
      if (!active) {
        try { (screen.orientation as unknown as { unlock?: () => void }).unlock?.(); } catch { /* ignore */ }
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Modo pseudo (iOS): seguir la orientación física del dispositivo.
  //  - Girar a horizontal → quitar la rotación CSS (ya no hace falta).
  //  - Volver a vertical después de estar horizontal → salir de fullscreen
  //    (restaurar el estado original, como pide el gesto natural).
  useEffect(() => {
    if (!pseudoFullscreen) return;
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => {
      if (mq.matches) {
        setCssRotate(false);
      } else if (!cssRotate) {
        exitFullscreen();
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pseudoFullscreen, cssRotate, exitFullscreen]);

  // ── Cerrar con ESC (o salir de fullscreen si está activo) ────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pseudoFullscreen || document.fullscreenElement) {
        exitFullscreen();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, pseudoFullscreen, exitFullscreen]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('cameraLabel', { name: cameraName })}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={containerRef}
        className="relative flex h-full w-full flex-col bg-card shadow-2xl overflow-hidden sm:h-auto sm:max-h-[95dvh] md:max-h-[95vh] sm:max-w-5xl sm:rounded-2xl md:animate-scale-in"
        style={
          pseudoFullscreen
            ? cssRotate
              ? {
                  // Dispositivo en vertical: rotar el contenido 90° para
                  // simular apaisado ocupando toda la pantalla.
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  width: '100dvh',
                  height: '100dvw',
                  maxWidth: 'none',
                  maxHeight: 'none',
                  borderRadius: 0,
                  transform: 'rotate(90deg) translateY(-100%)',
                  transformOrigin: 'top left',
                  zIndex: 60,
                }
              : {
                  position: 'fixed',
                  inset: 0,
                  width: '100dvw',
                  height: '100dvh',
                  maxWidth: 'none',
                  maxHeight: 'none',
                  borderRadius: 0,
                  zIndex: 60,
                }
            : undefined
        }
      >
        {/* ── Cabecera ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm">{cameraName}</span>
            {/* Botón DIRECTO siempre visible */}
            <button
              type="button"
              onClick={backToLive}
              disabled={isLive}
              className={[
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all',
                isLive
                  ? 'bg-red-500/15 text-red-400 cursor-default'
                  : 'bg-muted text-muted-foreground hover:bg-red-500/15 hover:text-red-400',
              ].join(' ')}
              title={isLive ? t('watchingLive') : t('backToLive')}
            >
              <Radio className={`size-3 ${isLive ? 'animate-pulse' : ''}`} />
              {t('live')}
              {!isLive && (
                <span className="ml-0.5 size-1.5 rounded-full bg-muted-foreground/40" />
              )}
              {isLive && (
                <span className="ml-0.5 size-1.5 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
            {streamMode === 'hls' && isLive && (
              <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-medium text-yellow-500" title={t('hlsFallbackTitle')}>
                HLS
              </span>
            )}
            {!isLive && playingSegment && (
              <span className="text-[11px] text-muted-foreground">
                {t('playing', { time: formatTime(playingSegment.startIso) })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
              title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
              title={tc('close')}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* ── Cuerpo scrollable ─────────────────────────────────────────── */}
        {/* En móvil el modal ocupa toda la pantalla y el cuerpo hace scroll
            vertical propio; en md+ mantiene el layout de columnas con scroll
            interno por sección (overflow visible como antes). */}
        <div className={`flex flex-col flex-1 min-h-0 ${isFullscreen ? 'overflow-hidden' : 'overflow-y-auto md:overflow-visible'} styled-scrollbar`}>

        {/* ── Área principal: vídeo a la izquierda, eventos a la derecha en lg+ ── */}
        {/* El layout lado-a-lado de escritorio se reserva para lg (≥1024px): las
            tablets en vertical (md, 768-1023px) usan el layout en columna como
            en móvil para no cortar la imagen. */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0">

        {/* ── Columna izquierda: vídeo + controles + timeline ──────────────── */}
        {/* En móvil/tablet se mantiene fija (shrink-0): la imagen y los controles
            quedan visibles y solo la lista de grabaciones hace scroll. */}
        <div className={`flex flex-col min-h-0 ${isFullscreen ? 'flex-1' : 'shrink-0 lg:flex-1'}`}>

        {/* ── Vídeo ─────────────────────────────────────────────────────── */}
        <div className={`relative bg-muted/80 dark:bg-neutral-900 w-full flex items-center justify-center overflow-hidden ${isFullscreen ? 'flex-1 min-h-0' : 'aspect-video lg:aspect-auto lg:flex-1'}`}>
          {/* Snapshot de fondo — se muestra mientras carga o si hay error */}
          {snapshotUrl && !streamReady && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={snapshotUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-contain blur-[2px] opacity-60"
            />
          )}
          {/* MJPEG stream — tablet live view only */}
          {isTablet && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              alt=""
              className={`relative h-full w-full object-contain${isLive ? '' : ' hidden'}`}
              onLoad={() => setStreamReady(true)}
              onError={() => {
                setStreamReady(false);
                setStreamError(tRef.current('connectionError'));
                setErrorType('other');
              }}
            />
          )}
          <video
            ref={attachVideoRef}
            onClick={() => {
              // Tap en el vídeo = pausar/reanudar (directo y grabaciones)
              if (streamReady && !streamError) togglePlayback();
            }}
            className={`relative h-full w-full object-contain cursor-pointer${isTablet && isLive ? ' hidden' : ''}`}
            playsInline
            autoPlay
          />

          {/* Indicador de pausa (tap para reanudar) */}
          {streamReady && playbackPaused && !streamError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="rounded-full bg-black/50 p-4 backdrop-blur-[2px]">
                <Play className="size-8 text-white" />
              </div>
            </div>
          )}

          {/* Overlay de carga */}
          {!streamReady && !streamError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/40 dark:bg-black/40 backdrop-blur-[2px] text-foreground dark:text-white">
              {(() => {
                const radius = 32;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference * (1 - Math.min(loadingProgress, 100) / 100);
                return (
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle
                      cx="40" cy="40" r={radius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="5"
                      opacity={0.15}
                    />
                    <circle
                      cx="40" cy="40" r={radius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      transform="rotate(-90 40 40)"
                      style={{ transition: 'stroke-dashoffset 0.15s ease-out' }}
                    />
                    <text
                      x="40" y="45"
                      textAnchor="middle"
                      fill="currentColor"
                      fontSize="15"
                      fontWeight="600"
                      fontFamily="sans-serif"
                    >
                      {Math.round(loadingProgress)}%
                    </text>
                  </svg>
                );
              })()}
              <p className="text-sm">{t('connecting')}</p>
            </div>
          )}

          {/* Overlay de error */}
          {streamError && (isLive || !isTablet) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/60 dark:bg-black/70 backdrop-blur-[2px] px-8 text-center text-foreground dark:text-white">
              <AlertCircle className="size-10 text-red-400 shrink-0" />
              <p className="text-sm max-w-sm">{streamError}</p>

              {/* Formulario para RTSP inline */}
              {errorType === 'no_rtsp' && (
                <div className="w-full max-w-sm space-y-2">
                  {rtspSaved ? (
                    <p className="flex items-center gap-1.5 justify-center text-green-400 text-sm">
                      <Check className="size-4" /> {t('rtspSaved')}
                    </p>
                  ) : showRtspForm ? (
                    <>
                      <input
                        type="url"
                        placeholder="rtsp://192.168.1.x/ch0_0.h264"
                        value={rtspInput}
                        onChange={(e) => setRtspInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveRtspAndRetry()}
                        className="w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:border-white/50"
                        autoFocus
                      />
                      <button
                        type="button"
                        disabled={!rtspInput || savingRtsp}
                        onClick={saveRtspAndRetry}
                        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                      >
                        {savingRtsp && <Loader2 className="size-4 animate-spin" />}
                        {t('saveAndConnect')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setRtspInput('rtsp://'); setShowRtspForm(true); }}
                      className="flex items-center gap-2 rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/20 transition"
                    >
                      <Settings2 className="size-4" /> {t('configureRtsp')}
                    </button>
                  )}
                </div>
              )}

              {errorType !== 'no_rtsp' && (
                <button
                  type="button"
                  onClick={isLive ? initLiveStream : () => playingSegment && playSegment(playingSegment)}
                  className="rounded-md bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20 transition"
                >
                  {tc('retry')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Controles de reproducción (pausa + saltar a minuto/segundo) ─── */}
        {!isLive && playingSegment && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 shrink-0">
            <button
              type="button"
              onClick={() => seekTo(playbackTime - 10)}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
              title={t('back10s')}
            >
              <SkipBack className="size-4" />
            </button>
            <button
              type="button"
              onClick={togglePlayback}
              className="rounded-full bg-primary/15 p-2 text-primary hover:bg-primary/25 transition"
              title={playbackPaused ? t('play') : t('pause')}
            >
              {playbackPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => seekTo(playbackTime + 10)}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
              title={t('forward10s')}
            >
              <SkipForward className="size-4" />
            </button>
            <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatClock(playbackTime)}
            </span>
            <input
              type="range"
              min={0}
              max={playbackDuration || 0}
              step={0.1}
              value={Math.min(playbackTime, playbackDuration || 0)}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              className="flex-1 accent-primary"
              aria-label={t('seek')}
            />
            <span className="w-10 text-[11px] tabular-nums text-muted-foreground">
              {formatClock(playbackDuration)}
            </span>
            <button
              type="button"
              onClick={() => playingSegment && downloadSegment(playingSegment)}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
              title={t('download')}
            >
              <Download className="size-4" />
            </button>
          </div>
        )}

        {/* ── Controles de audio ─────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 flex-wrap gap-y-1">
          <button
            type="button"
            onClick={() => {
              const newMuted = !muted;
              setMuted(newMuted);
              // Controlar directamente via DOM para evitar el bug de React con muted
              const video = videoRef.current;
              if (video) {
                video.muted = newMuted;
                if (!newMuted && video.paused) {
                  video.play().catch(() => undefined);
                }
              }
            }}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
            title={muted ? t('unmute') : t('mute')}
          >
            {muted || volume === 0 ? (
              <VolumeX className="size-4" />
            ) : volume < 0.5 ? (
              <Volume1 className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              const video = videoRef.current;
              if (video) {
                video.volume = v;
                if (v > 0) {
                  video.muted = false;
                  setMuted(false);
                }
              }
            }}
            className="w-28 accent-primary"
            aria-label={t('volume')}
          />
          <span className="text-xs text-muted-foreground w-8">
            {muted ? '0' : Math.round(volume * 100)}%
          </span>

          {/* Indicador de pista de audio WebRTC */}
          {isLive && (
            <span
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                hasAudioTrack
                  ? 'bg-green-500/15 text-green-500'
                  : 'bg-muted text-muted-foreground/50'
              }`}
              title={hasAudioTrack ? t('audioTrackReceived') : t('noAudioDetected')}
            >
              <Mic className="size-2.5" />
              {hasAudioTrack ? t('audioOk') : t('noAudio')}
            </span>
          )}

          {muted && streamReady && hasAudioTrack && (
            <button
              type="button"
              onClick={() => {
                setMuted(false);
                const video = videoRef.current;
                if (video) {
                  video.muted = false;
                  if (video.paused) video.play().catch(() => undefined);
                }
              }}
              className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25 transition animate-pulse"
            >
              <Volume2 className="size-3" /> {t('tapToEnableAudio')}
            </button>
          )}

          {/* Botón diagnóstico (solo en directo y sin audio) */}
          {isLive && !hasAudioTrack && streamReady && (
            <button
              type="button"
              onClick={loadDiag}
              disabled={loadingDiag}
              className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition"
              title={t('audioDiagnosis')}
            >
              {loadingDiag ? <Loader2 className="size-3 animate-spin" /> : <AlertCircle className="size-3" />}
              {t('diagnoseAudio')}
            </button>
          )}
        </div>

        {/* ── Panel de diagnóstico ───────────────────────────────────────── */}
        {!isFullscreen && showDiag && audioDiag && (
          <div className="mx-4 my-2 rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">{t('audioDiagnosis')}</span>
              <button type="button" onClick={() => setShowDiag(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            </div>

            {/* Estado del stream */}
            <div className="flex flex-wrap gap-2">
              <span className={`px-2 py-0.5 rounded-full ${audioDiag.streamActive ? 'bg-green-500/15 text-green-600' : 'bg-red-500/15 text-red-500'}`}>
                {audioDiag.streamActive ? `● ${t('streamActive')}` : `○ ${t('streamInactive')}`}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${audioDiag.hasVideoTrack ? 'bg-green-500/15 text-green-600' : 'bg-red-500/15 text-red-500'}`}>
                🎥 {audioDiag.hasVideoTrack ? t('videoOk') : t('noVideo')}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${audioDiag.hasAudioTrack ? 'bg-green-500/15 text-green-600' : 'bg-red-500/15 text-red-500'}`}>
                🎤 {audioDiag.hasAudioTrack ? t('audioCheckOk') : t('audioCheckNo')}
              </span>
            </div>

            {/* Tracks/codecs detectados por go2rtc */}
            {audioDiag.tracks.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-muted-foreground w-full">{t('codecsReceived')}</span>
                {audioDiag.tracks.map((trk, i) => (
                  <span
                    key={i}
                    className={`px-2 py-0.5 rounded-full font-mono ${
                      trk.type === 'audio'
                        ? 'bg-blue-500/15 text-blue-500'
                        : 'bg-green-500/15 text-green-600'
                    }`}
                  >
                    {trk.type === 'audio' ? '🎤' : '🎥'} {trk.codec}{trk.profile ? ` (${trk.profile})` : ''}
                  </span>
                ))}
              </div>
            )}

            {/* Media lines de go2rtc */}
            {audioDiag.mediaLines.length > 0 && (
              <div>
                <span className="text-muted-foreground">{t('producerMedias')}</span>
                <ul className="mt-0.5 space-y-0.5">
                  {audioDiag.mediaLines.map((m, i) => (
                    <li key={i} className="font-mono text-foreground/80 pl-2">• {m}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Problemas detectados */}
            {audioDiag.issues.length > 0 && (
              <div className="space-y-1">
                <span className="text-muted-foreground font-medium">{t('issues')}</span>
                <ul className="space-y-1">
                  {audioDiag.issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-red-500 dark:text-red-400">
                      <AlertCircle className="size-3 mt-0.5 shrink-0" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sugerencias */}
            {audioDiag.suggestions.length > 0 && (
              <div className="space-y-1">
                <span className="text-muted-foreground font-medium">{t('solutions')}</span>
                <ol className="list-decimal ml-4 space-y-0.5 text-amber-600 dark:text-amber-400">
                  {audioDiag.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* URLs alternativas probadas */}
            {audioDiag.alternativeUrls && audioDiag.alternativeUrls.length > 0 && (
              <div className="space-y-1">
                <span className="text-muted-foreground font-medium">{t('rtspUrlsTested')}</span>
                <ul className="space-y-0.5">
                  {audioDiag.alternativeUrls.map((alt, i) => (
                    <li key={i} className="flex items-center gap-1.5 font-mono">
                      <span className={`size-2 rounded-full ${alt.hasAudio ? 'bg-green-500' : alt.error ? 'bg-muted-foreground/30' : 'bg-red-500'}`} />
                      <span className="text-foreground/80">{alt.url}</span>
                      {alt.hasAudio && <span className="text-green-500 font-sans">🎤 {t('hasAudio')}</span>}
                      {alt.error && <span className="text-muted-foreground font-sans">({alt.error})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {audioDiag.hasAudioTrack && (
              <p className="text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                <Check className="size-3" /> {t('go2rtcDetectsAudio')}
              </p>
            )}
          </div>
        )}

        {/* ── Timeline de grabaciones (oculto en pantalla completa) ──────── */}
        <div className={isFullscreen ? 'hidden' : 'px-4 py-3 space-y-2'}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('recordingHistory')}
            </span>
            <div className="flex items-center gap-2">
              {!isLive && playingSegment && (
                <span className="text-xs text-muted-foreground">
                  {formatTime(playingSegment.startIso)}
                  {playingIndex >= 0 && playingIndex < segments.length - 1 && (
                    <span className="text-muted-foreground/50"> {t('continuousPlayback')}</span>
                  )}
                </span>
              )}
              <DatePicker
                value={selectedDate}
                onChange={setSelectedDate}
              />
            </div>
          </div>

          {/* Marcas horarias */}
          <div className="relative h-3 w-full">
            {Array.from({ length: 13 }, (_, i) => i * 2).map((h) => (
              <span
                key={h}
                className="absolute text-[9px] text-muted-foreground/60 -translate-x-1/2 select-none"
                style={{ left: `${(h / 24) * 100}%` }}
              >
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>

          {/* Barra de 24h */}
          <div className="relative h-10 w-full rounded-md bg-muted overflow-hidden">
            {/* Líneas de hora (guías verticales) */}
            {Array.from({ length: 24 }, (_, i) => i).map((h) => (
              <div
                key={h}
                className="absolute top-0 bottom-0 w-px bg-border/30 pointer-events-none"
                style={{ left: `${(h / 24) * 100}%` }}
              />
            ))}

            {/* Indicador de tiempo actual */}
            {selectedDate === todayStr() && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
                style={{ left: `${(isoToMinutes(new Date().toISOString()) / (24 * 60)) * 100}%` }}
              />
            )}

            {/* Eventos agrupados (fondo destacado) */}
            {events.map((evt, i) => {
              const start = isoToMinutes(evt.startIso);
              const duration = evt.durationSec / 60; // en minutos
              const left = (start / (24 * 60)) * 100;
              const width = (duration / (24 * 60)) * 100;

              const isPlayingInEvent =
                !isLive &&
                playingIndex >= evt.firstIndex &&
                playingIndex <= evt.lastIndex;

              return (
                <button
                  key={`evt-${i}`}
                  type="button"
                  title={`${formatTime(evt.startIso)} – ${formatTime(evt.endIso)} · ${formatDuration(evt.durationSec)}${evt.type === 'motion' || evt.type === 'both' ? ` · ${t('motion')}` : ''}${evt.type === 'sound' || evt.type === 'both' ? ` · ${t('sound')}` : ''}`}
                  onClick={() => { const s = segments[evt.firstIndex]; if (s) playSegment(s, evt.firstIndex); }}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                  className={[
                    'absolute top-0 bottom-0 z-10 rounded-sm border-y-2 transition-all cursor-pointer',
                    isPlayingInEvent
                      ? 'opacity-100 ring-2 ring-white ring-offset-1 ring-offset-black'
                      : 'opacity-90 hover:opacity-100 hover:scale-y-110',
                    evt.type === 'both'
                      ? 'bg-orange-400/90 border-orange-500'
                      : evt.type === 'motion'
                        ? 'bg-yellow-400/90 border-yellow-500'
                        : evt.type === 'sound'
                          ? 'bg-blue-400/90 border-blue-500'
                          : 'bg-primary/60 border-primary',
                  ].join(' ')}
                />
              );
            })}

            {/* Segmentos individuales (sin evento) como barras más finas */}
            {segments.map((seg, i) => {
              // No dibujar segmentos que ya están cubiertos por un evento
              const inEvent = events.some((e) => i >= e.firstIndex && i <= e.lastIndex);
              if (inEvent) return null;

              const start = isoToMinutes(seg.startIso);
              const width = (seg.durationSec / 60 / (24 * 60)) * 100;
              const left = (start / (24 * 60)) * 100;
              const isPlaying =
                playingSegment?.startIso === seg.startIso && !isLive;

              return (
                <button
                  key={`seg-${i}`}
                  type="button"
                  title={`${formatTime(seg.startIso)}`}
                  onClick={() => playSegment(seg, i)}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%` }}
                  className={[
                    'absolute top-1/4 bottom-1/4 transition-opacity rounded-sm',
                    isPlaying
                      ? 'opacity-100 ring-1 ring-white'
                      : 'opacity-60 hover:opacity-100',
                    'bg-primary/40',
                  ].join(' ')}
                />
              );
            })}

            {/* Marcadores de detección (motion events de la BD) */}
            {motionEvents.map((evt, i) => {
              const min = isoToMinutes(evt.occurredAt);
              const left = (min / (24 * 60)) * 100;
              return (
                <div
                  key={`mevt-${i}`}
                  title={`${new Date(evt.occurredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${t(evt.type)}`}
                  style={{ left: `${left}%` }}
                  className={[
                    'absolute top-0 w-0.5 h-full z-15 pointer-events-none opacity-70',
                    evt.type === 'sound' ? 'bg-blue-400'
                      : evt.type === 'human' ? 'bg-green-400'
                      : evt.type === 'animal' ? 'bg-purple-400'
                      : 'bg-yellow-400',
                  ].join(' ')}
                />
              );
            })}

            {loadingRecordings ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('loadingRecordings')}
              </div>
            ) : recordingsError && segments.length === 0 ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 text-xs text-destructive">
                <span>
                  {recordingsError === 'unreachable'
                    ? t('recordingsUnreachable')
                    : t('recordingsLoadError')}
                </span>
                <button
                  type="button"
                  onClick={() => setRecordingsReload((n) => n + 1)}
                  className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-accent transition"
                >
                  {tc('retry')}
                </button>
              </div>
            ) : segments.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                {t('noRecordingsToday')}
              </div>
            ) : null}
          </div>

          {recordingsPartial && !loadingRecordings && (
            <div className="flex items-center gap-2 text-[11px] text-amber-500">
              <span>{t('recordingsPartial')}</span>
              <button
                type="button"
                onClick={() => setRecordingsReload((n) => n + 1)}
                className="underline underline-offset-2 hover:text-foreground transition"
              >
                {tc('retry')}
              </button>
            </div>
          )}

          {/* Leyenda */}
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Activity className="size-3 text-yellow-400" />
              <span className="size-2.5 rounded-sm bg-yellow-400" /> {t('motion')}
            </span>
            <span className="flex items-center gap-1">
              <Mic className="size-3 text-blue-400" />
              <span className="size-2.5 rounded-sm bg-blue-400" /> {t('sound')}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-orange-400" /> {t('both')}
            </span>
            {events.length > 0 && (
              <span className="ml-auto text-muted-foreground/70">
                {t('eventsDetected', { count: events.length })}
              </span>
            )}
          </div>
        </div>

        </div>{/* cierre columna izquierda */}

        {/* ── Lista de eventos con segmentos expandibles ─────────────────── */}
        {!isFullscreen && events.length > 0 && (
          <div className="border-t border-border/60 lg:border-t-0 lg:border-l flex flex-col min-h-0 flex-1 lg:flex-none lg:max-h-none lg:w-72">
            <div className="px-4 py-2 shrink-0 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('recordings')}
              </span>
              {/* Filtros clicables */}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'motion' ? 'all' : 'motion')}
                  title={t('motion')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'motion'
                      ? 'bg-yellow-400/20 text-yellow-500'
                      : 'text-muted-foreground/50 hover:text-yellow-500 hover:bg-yellow-400/10',
                  ].join(' ')}
                >
                  <Activity className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'sound' ? 'all' : 'sound')}
                  title={t('sound')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'sound'
                      ? 'bg-blue-400/20 text-blue-500'
                      : 'text-muted-foreground/50 hover:text-blue-500 hover:bg-blue-400/10',
                  ].join(' ')}
                >
                  <Mic className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'human' ? 'all' : 'human')}
                  title={t('human')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'human'
                      ? 'bg-green-400/20 text-green-500'
                      : 'text-muted-foreground/50 hover:text-green-500 hover:bg-green-400/10',
                  ].join(' ')}
                >
                  <User className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'animal' ? 'all' : 'animal')}
                  title={t('animal')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'animal'
                      ? 'bg-purple-400/20 text-purple-500'
                      : 'text-muted-foreground/50 hover:text-purple-500 hover:bg-purple-400/10',
                  ].join(' ')}
                >
                  <PawPrint className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto min-h-0 flex-1 styled-scrollbar">
            <div className="divide-y divide-border/40">
              {[...events]
                .filter((evt) => eventFilter === 'all' || evt.type === eventFilter || (eventFilter === 'motion' && evt.type === 'both') || (eventFilter === 'sound' && evt.type === 'both'))
                .reverse()
                .map((evt) => {
                const isPlayingThis =
                  !isLive &&
                  playingIndex >= evt.firstIndex &&
                  playingIndex <= evt.lastIndex;
                // idx aquí es el índice dentro del array invertido; usamos
                // evt.firstIndex como key estable para no perder el estado
                // de expandedEvent (que referencia firstIndex, no el idx visual).
                const isExpanded = expandedEvent === evt.firstIndex;
                const segCount = evt.lastIndex - evt.firstIndex + 1;

                return (
                  <div key={evt.firstIndex}>
                    {/* Cabecera del evento */}
                    <button
                      type="button"
                      onClick={() => setExpandedEvent(isExpanded ? null : evt.firstIndex)}
                      className={[
                        'flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors',
                        isPlayingThis
                          ? 'bg-primary/10'
                          : 'hover:bg-accent/50',
                      ].join(' ')}
                    >
                      {/* Chevron */}
                      {isExpanded
                        ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}

                      {/* Badge de tipo */}
                      <div className={[
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                        evt.type === 'both'
                          ? 'bg-orange-400/15 text-orange-500'
                          : evt.type === 'motion'
                            ? 'bg-yellow-400/15 text-yellow-500'
                            : 'bg-blue-400/15 text-blue-500',
                      ].join(' ')}>
                        {evt.type === 'both' ? (
                          <span className="flex items-center gap-1">
                            <Activity className="size-3" /><Mic className="size-3" />
                          </span>
                        ) : evt.type === 'motion' ? (
                          <Activity className="size-3" />
                        ) : (
                          <Mic className="size-3" />
                        )}
                      </div>

                      {/* Info del evento */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">
                          {formatTime(evt.startIso)} – {formatTime(evt.endIso)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDuration(evt.durationSec)} · {segCount} {segCount === 1 ? t('clip') : t('clips')}
                        </p>
                      </div>

                      {/* Botón play rápido (div role=button para evitar button-in-button) */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          const s = segments[evt.firstIndex];
                          if (s) playSegment(s, evt.firstIndex);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            const s = segments[evt.firstIndex];
                            if (s) playSegment(s, evt.firstIndex);
                          }
                        }}
                        className={[
                          'shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer',
                          isPlayingThis
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted hover:bg-primary/15 hover:text-primary text-muted-foreground',
                        ].join(' ')}
                        title={t('playEvent')}
                      >
                        <Play className="size-3" />
                      </div>

                      {/* Indicador de reproducción */}
                      {isPlayingThis && (
                        <span className="shrink-0 size-2 rounded-full bg-primary animate-pulse" />
                      )}

                      {/* Botón eliminar evento (div para evitar button-in-button) */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEvents((prev) => prev.filter((ev) => ev.firstIndex !== evt.firstIndex));
                          if (expandedEvent === evt.firstIndex) setExpandedEvent(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setEvents((prev) => prev.filter((ev) => ev.firstIndex !== evt.firstIndex));
                            if (expandedEvent === evt.firstIndex) setExpandedEvent(null);
                          }
                        }}
                        className="shrink-0 rounded-md p-1 text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition cursor-pointer"
                        title={t('deleteEvent')}
                      >
                        <Trash2 className="size-3" />
                      </div>
                    </button>

                    {/* Segmentos individuales expandidos */}
                    {isExpanded && (
                      <div className="bg-muted/30">
                        {segments.slice(evt.firstIndex, evt.lastIndex + 1).map((seg, segIdx) => {
                          const globalIdx = evt.firstIndex + segIdx;
                          const isSegPlaying = !isLive && playingIndex === globalIdx;
                          return (
                            <button
                              key={globalIdx}
                              type="button"
                              onClick={() => playSegment(seg, globalIdx)}
                              className={[
                                'flex items-center gap-3 w-full pl-11 pr-4 py-2 text-left transition-colors border-t border-border/20',
                                isSegPlaying
                                  ? 'bg-primary/10'
                                  : 'hover:bg-accent/40',
                              ].join(' ')}
                            >
                              <Film className="size-3 shrink-0 text-muted-foreground/60" />
                              <span className="text-xs font-mono">
                                {formatTime(seg.startIso)}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatDuration(seg.durationSec)}
                              </span>
                              <span className="flex-1" />
                              {isSegPlaying ? (
                                <span className="shrink-0 size-2 rounded-full bg-primary animate-pulse" />
                              ) : (
                                <Play className="size-3 shrink-0 text-muted-foreground/40" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>{/* cierre scroll contenedor detecciones */}
          </div>
        )}

        {/* ── Lista de detecciones sin vídeo (tablet / IP Webcam) ─────────── */}
        {/* Solo como fallback cuando NO hay grabaciones reproducibles de la SD:
            si hay grabaciones, el panel de arriba ya lo cubre y mostrar ambos
            duplicaba el listado con entradas que no se pueden reproducir. */}
        {!isFullscreen && events.length === 0 && (isTablet ? ipWebcamSegs.length > 0 : (motionEvents.length > 0 || motionActive || soundActive)) && (
          <div className="border-t border-border/60 lg:border-t-0 lg:border-l flex flex-col min-h-0 flex-1 lg:flex-none lg:max-h-none lg:w-72">
            <div className="px-4 py-2 shrink-0 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('detections')}
              </span>
              {!isTablet && motionActive && (
                <span className="flex items-center gap-1 rounded-full bg-yellow-400/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
                  <span className="size-1.5 rounded-full bg-yellow-500 animate-pulse" />
                  {t('motion')}
                </span>
              )}
              {!isTablet && soundActive && (
                <span className="flex items-center gap-1 rounded-full bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
                  <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {t('sound')}
                </span>
              )}
              {/* Filtros clicables */}
              {!isTablet && <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'motion' ? 'all' : 'motion')}
                  title={t('motion')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'motion'
                      ? 'bg-yellow-400/20 text-yellow-500'
                      : 'text-muted-foreground/50 hover:text-yellow-500 hover:bg-yellow-400/10',
                  ].join(' ')}
                >
                  <Activity className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'sound' ? 'all' : 'sound')}
                  title={t('sound')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'sound'
                      ? 'bg-blue-400/20 text-blue-500'
                      : 'text-muted-foreground/50 hover:text-blue-500 hover:bg-blue-400/10',
                  ].join(' ')}
                >
                  <Mic className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'human' ? 'all' : 'human')}
                  title={t('human')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'human'
                      ? 'bg-green-400/20 text-green-500'
                      : 'text-muted-foreground/50 hover:text-green-500 hover:bg-green-400/10',
                  ].join(' ')}
                >
                  <User className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEventFilter(eventFilter === 'animal' ? 'all' : 'animal')}
                  title={t('animal')}
                  className={[
                    'rounded-md p-1 transition',
                    eventFilter === 'animal'
                      ? 'bg-purple-400/20 text-purple-500'
                      : 'text-muted-foreground/50 hover:text-purple-500 hover:bg-purple-400/10',
                  ].join(' ')}
                >
                  <PawPrint className="size-3.5" />
                </button>
              </div>}
              {!isTablet && motionEvents.length > 0 && (
                <span className="w-full text-[10px] text-muted-foreground/60">
                  {t('eventsDetected', { count: motionEvents.length })}
                </span>
              )}
            </div>
            <div className="overflow-y-auto min-h-0 flex-1 styled-scrollbar">
              {/* Grabaciones del tablet (APK) */}
              {ipWebcamSegs.length > 0 && (
                <div className="border-b border-border/30">
                  <div className="px-4 pt-2 pb-1 flex items-center gap-1.5">
                    <Film className="size-3 text-muted-foreground" />
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                      {t('recordingHistory')}
                    </span>
                    <span className="ml-1 text-[10px] text-muted-foreground/60">
                      · {ipWebcamSegs.length}
                    </span>
                  </div>
                  <div className="divide-y divide-border/20">
                    {ipWebcamSegs.map((seg, i) => {
                      const isPlaying = !isLive && playingSegment?.proxyUrl === seg.proxyUrl;
                      return (
                        <div
                          key={i}
                          className={[
                            'flex items-center transition-colors',
                            isPlaying
                              ? 'bg-primary/10'
                              : seg.favorite
                                ? 'bg-amber-400/5 hover:bg-amber-400/10'
                                : 'hover:bg-accent/40',
                          ].join(' ')}
                        >
                          <button
                            type="button"
                            onClick={() => playSegment(seg)}
                            className="flex items-center gap-3 flex-1 min-w-0 px-4 py-2 text-left"
                          >
                            {seg.favorite ? (
                              <Star
                                className="size-3 shrink-0 fill-amber-400 text-amber-400"
                                aria-label={t('favorites')}
                              />
                            ) : (
                              <Film className="size-3 shrink-0 text-muted-foreground/50" />
                            )}
                            <span className="text-xs font-mono">{formatTime(seg.startIso)}</span>
                            <span className="text-[11px] text-muted-foreground/80">
                              {formatDuration(seg.durationSec)}
                            </span>
                            <span className="flex-1" />
                            {isPlaying
                              ? <span className="shrink-0 size-2 rounded-full bg-primary animate-pulse" />
                              : <Play className="size-3 shrink-0 text-muted-foreground/40" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadSegment(seg)}
                            className="shrink-0 px-3 py-2 text-muted-foreground/50 hover:text-foreground transition-colors"
                            title={t('download')}
                            aria-label={t('download')}
                          >
                            <Download className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {!isTablet && <div className="divide-y divide-border/40">
                {[...motionEvents]
                  .filter((e) => eventFilter === 'all' || e.type === eventFilter)
                  .reverse()
                  .map((evt, i) => {
                  const evtMs = new Date(evt.occurredAt).getTime();
                  // Match against IP Webcam segments
                  const matchingIpSeg = ipWebcamSegs.find(
                    (s) => evtMs <= s.mtimeMs && evtMs >= s.mtimeMs - (s.durationSec + 60) * 1000,
                  );
                  // Match against yi-hack SD card segments (find closest segment that overlaps the event time)
                  const matchingYiSeg = !matchingIpSeg ? segments.find((s) => {
                    const segStart = new Date(s.startIso).getTime();
                    const segEnd = segStart + s.durationSec * 1000;
                    // Event falls within segment time range (with 60s tolerance)
                    return evtMs >= segStart - 60000 && evtMs <= segEnd + 60000;
                  }) : undefined;
                  // Fallback: use the event's own clip URL when no recording segment matches
                  const clipSeg: RecordingSegment | undefined =
                    !matchingIpSeg && !matchingYiSeg && evt.clipUrl
                      ? { startIso: evt.occurredAt, durationSec: 0, proxyUrl: evt.clipUrl, motion: evt.type === 'motion', sound: evt.type === 'sound' }
                      : undefined;
                  const playableSeg = matchingIpSeg ?? matchingYiSeg ?? clipSeg;
                  const isPlayingThis =
                    !isLive && !!playableSeg && playingSegment?.proxyUrl === playableSeg.proxyUrl;
                  return (
                    <div
                      key={`${evt.occurredAt}-${evt.type}-${i}`}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <div className={[
                        'shrink-0 rounded-md px-1.5 py-0.5',
                        evt.type === 'sound'
                          ? 'bg-blue-400/15 text-blue-500'
                          : evt.type === 'human'
                            ? 'bg-green-400/15 text-green-500'
                            : evt.type === 'animal'
                              ? 'bg-purple-400/15 text-purple-500'
                              : 'bg-yellow-400/15 text-yellow-500',
                      ].join(' ')}>
                        {evt.type === 'sound'
                          ? <Mic className="size-3" />
                          : evt.type === 'human'
                            ? <User className="size-3" />
                            : evt.type === 'animal'
                              ? <PawPrint className="size-3" />
                              : <Activity className="size-3" />}
                      </div>
                      <span className="text-xs font-mono font-medium">
                        {new Date(evt.occurredAt).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span className="text-[11px] text-muted-foreground capitalize flex-1">
                        {t(evt.type)}
                      </span>
                      {playableSeg && (
                        <button
                          type="button"
                          onClick={() => playSegment(playableSeg)}
                          className={[
                            'shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer',
                            isPlayingThis
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted hover:bg-primary/15 hover:text-primary text-muted-foreground',
                          ].join(' ')}
                          title={t('playEvent')}
                        >
                          <Play className="size-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteMotionEvent(evt.id)}
                        disabled={deletingEventId === evt.id}
                        className="shrink-0 rounded-md p-1 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-30"
                        title={t('deleteEvent')}
                      >
                        {deletingEventId === evt.id
                          ? <Loader2 className="size-3 animate-spin" />
                          : <Trash2 className="size-3" />}
                      </button>
                    </div>
                  );
                })}
              </div>}
            </div>
          </div>
        )}

        </div>{/* cierre área principal */}

        {/* ── Pie: Borrar memoria SD ─────────────────────────────────────── */}
        {!isTablet && !isFullscreen && (
        <div className="flex flex-col gap-1.5 px-4 py-2.5 border-t border-border/60 shrink-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <span className="text-[11px] text-muted-foreground leading-snug">
            {t('sdRecordings')}
          </span>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            {clearSDResult === 'success' && (
              <span className="text-[11px] text-green-500 flex items-center gap-1">
                <Check className="size-3" /> {t('sdCleared')}
              </span>
            )}
            {clearSDResult === 'error' && (
              <span className="text-[11px] text-red-400">
                {t('sdClearError')}
              </span>
            )}
            <button
              type="button"
              onClick={clearSD}
              disabled={clearingSD}
              className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
              title={t('clearSd')}
            >
              {clearingSD ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
              {t('clearSd')}
            </button>
          </div>
        </div>
        )}

        </div>{/* cierre cuerpo scrollable */}
      </div>
    </div>
  );
}
