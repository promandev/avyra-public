'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Modo sigiloso: mientras emite, muestra Ãºnicamente un reloj de pantalla
 * completa (aspecto de screensaver / standby). No hay ningÃºn indicador
 * visual de que la cÃ¡mara estÃ© activa.
 *
 * Para acceder a los controles: 5 toques rÃ¡pidos en menos de 2 s â†’ aparece
 * el botÃ³n de detener durante 6 s, luego se oculta de nuevo.
 */

const RECONNECT_DELAY_MS = 5000;
const ICE_GATHER_TIMEOUT_MS = 3000;
const SECRET_TAPS = 5;
const SECRET_WINDOW_MS = 2000;
const CONTROLS_VISIBLE_MS = 6000;

type StreamState = 'idle' | 'requesting' | 'streaming' | 'error' | 'reconnecting';

// â”€â”€ Reloj â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function useClock() {
  const [time, setTime] = useState(() => {
    const d = new Date();
    return {
      hm: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      date: d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  });

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime({
        hm: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        date: d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
      });
    };
    // Sincronizar con el siguiente minuto exacto
    const now = Date.now();
    const msToNext = 60_000 - (now % 60_000);
    let interval: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msToNext);
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, []);

  return time;
}

// â”€â”€ Componente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function TabletStreamer({
  cameraId,
  cameraName,
}: {
  cameraId: string;
  cameraName: string;
  streamId: string;
}) {
  const t = useTranslations('cameras');
  const [state, setState] = useState<StreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const { hm, date } = useClock();

  // Gesto secreto: 5 toques rÃ¡pidos
  const tapTimestamps = useRef<number[]>([]);
  const [showControls, setShowControls] = useState(false);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const mountedRef = useRef(true);

  // Wake Lock
  useEffect(() => {
    let active = true;
    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          const lock = await navigator.wakeLock.request('screen');
          if (active) wakeLockRef.current = lock;
          else lock.release();
        }
      } catch { /* no crÃ­tico */ }
    }
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVis);
      wakeLockRef.current?.release().catch(() => undefined);
    };
  }, []);

  // Gesto secreto: 5 toques en < 2 s
  const handleSecretTap = useCallback(() => {
    const now = Date.now();
    tapTimestamps.current.push(now);
    // Descartar taps fuera de la ventana
    tapTimestamps.current = tapTimestamps.current.filter((ts) => now - ts < SECRET_WINDOW_MS);
    if (tapTimestamps.current.length >= SECRET_TAPS) {
      tapTimestamps.current = [];
      setShowControls(true);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      hideControlsTimer.current = setTimeout(() => setShowControls(false), CONTROLS_VISIBLE_MS);
    }
  }, []);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (hideControlsTimer.current) { clearTimeout(hideControlsTimer.current); hideControlsTimer.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  const startStreaming = useCallback(async () => {
    cleanup();
    setState('requesting');
    setError(null);

    let localStream: MediaStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch (e) {
      if (!mountedRef.current) return;
      setState('error');
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? t('tabletPermissionDenied')
          : t('tabletCameraError'),
      );
      return;
    }

    if (!mountedRef.current) { localStream.getTracks().forEach((t) => t.stop()); return; }
    streamRef.current = localStream;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

    pc.onconnectionstatechange = () => {
      if (!mountedRef.current) return;
      const s = pc.connectionState;
      if ((s === 'disconnected' || s === 'failed' || s === 'closed') && pcRef.current === pc) {
        setState('reconnecting');
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) startStreaming();
        }, RECONNECT_DELAY_MS);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(); } };
        pc.addEventListener('icegatheringstatechange', check);
        setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
      });
      if (pcRef.current !== pc) return;

      const res = await fetch(`/api/cameras/${cameraId}/whip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription!.sdp,
      });
      if (pcRef.current !== pc) return;

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      setState('streaming');
    } catch (e) {
      if (pcRef.current !== pc) return;
      cleanup();
      setState('error');
      setError(e instanceof Error ? e.message : t('tabletConnectionError'));
    }
  }, [cameraId, cleanup, t]);

  const stopStreaming = useCallback(() => {
    cleanup();
    setShowControls(false);
    setState('idle');
  }, [cleanup]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cleanup(); };
  }, [cleanup]);

  // â”€â”€ Pantalla en modo streaming: reloj stealth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (state === 'streaming') {
    return (
      <div
        className="fixed inset-0 bg-black flex flex-col items-center justify-center cursor-none select-none"
        onClick={handleSecretTap}
        onTouchEnd={(e) => { e.preventDefault(); handleSecretTap(); }}
      >
        {/* Reloj â€” aspecto screensaver normal */}
        <div className="text-center pointer-events-none" style={{ opacity: 0.6 }}>
          <div
            className="font-thin text-white tabular-nums"
            style={{ fontSize: 'clamp(4rem, 22vw, 12rem)', lineHeight: 1, letterSpacing: '-0.02em' }}
          >
            {hm}
          </div>
          <div className="mt-2 text-white/50 text-base font-light tracking-wide capitalize">
            {date}
          </div>
        </div>

        {/* Controles secretos â€” solo visibles tras 5 toques */}
        {showControls && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); stopStreaming(); }}
            className="absolute bottom-10 rounded-full bg-white/10 px-6 py-3 text-sm text-white/70 backdrop-blur-sm border border-white/10 pointer-events-auto"
          >
            {t('tabletStop')}
          </button>
        )}
      </div>
    );
  }

  // â”€â”€ Pantalla en modo reconnecting: negro puro â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (state === 'reconnecting') {
    return <div className="fixed inset-0 bg-black" />;
  }

  // â”€â”€ Pantalla en modo requesting: negro puro â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (state === 'requesting') {
    return <div className="fixed inset-0 bg-black" />;
  }

  // â”€â”€ Pantalla idle / error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-black text-white select-none">
      {state === 'idle' && (
        <div className="flex flex-col items-center gap-6 p-8 text-center">
          <div className="rounded-full bg-white/10 p-6">
            <svg className="size-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold">{cameraName}</h1>
            <p className="mt-1 text-sm text-white/60">{t('tabletReadyHint')}</p>
          </div>
          <button
            type="button"
            onClick={startStreaming}
            className="rounded-xl bg-white/15 px-8 py-3 text-sm font-medium backdrop-blur-sm transition hover:bg-white/25 active:scale-95"
          >
            {t('tabletStart')}
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center gap-4 p-8 text-center max-w-md">
          <div className="rounded-full bg-red-500/20 p-4">
            <svg className="size-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={startStreaming}
            className="rounded-xl bg-white/15 px-6 py-2.5 text-sm font-medium backdrop-blur-sm transition hover:bg-white/25 active:scale-95"
          >
            {t('tabletRetry')}
          </button>
        </div>
      )}
    </div>
  );
}
