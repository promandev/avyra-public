'use client';

import { useEffect, useState } from 'react';
import { CameraOff, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Muestra el snapshot de la cámara vía proxy y lo refresca cada N segundos.
 * El proxy /api/cameras/[id]/snapshot evita CORS y cifra la URL real.
 *
 * Cada snapshot se descarga en segundo plano (fetch → blob) y sólo se pinta
 * cuando es una imagen válida, así el <img> nunca apunta a una URL rota: el
 * navegador no llega a dibujar el icono de imagen rota ni el alt, y la card
 * conserva siempre su tamaño (el contenedor fija el aspect-video).
 *
 * Usa un contador de fallos consecutivos: sólo muestra "Sin señal" después
 * de 3 intentos fallidos seguidos, evitando parpadeos por errores puntuales.
 * Sigue reintentando con la card en "Sin señal" y se recupera sola.
 */
const FAIL_THRESHOLD = 3;
const FETCH_TIMEOUT_MS = 15_000;

export function CameraFeed({
  cameraId,
  refreshMs = 5000,
}: {
  cameraId: string;
  refreshMs?: number;
}) {
  const t = useTranslations('cameras');
  // Object URL del último snapshot válido — se mantiene visible mientras reintenta
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let failCount = 0;
    let currentUrl: string | null = null;
    let controller: AbortController | null = null;

    const load = async () => {
      // Sin solapar peticiones si la cámara tarda más que el intervalo, y sin
      // gastar sesiones de la cámara con la pestaña oculta.
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/cameras/${cameraId}/snapshot?t=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('empty');
        // Confirma que el navegador puede decodificarla antes de pintarla
        const url = URL.createObjectURL(blob);
        try {
          const probe = new Image();
          probe.src = url;
          await probe.decode();
        } catch (err) {
          URL.revokeObjectURL(url);
          throw err;
        }
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = url;
        failCount = 0;
        setImgUrl(url);
        setShowError(false);
      } catch {
        if (cancelled) return;
        failCount += 1;
        if (failCount >= FAIL_THRESHOLD) setShowError(true);
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };

    load();
    const interval = setInterval(load, refreshMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      controller?.abort();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [cameraId, refreshMs]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted/40">
      {imgUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgUrl}
          alt={t('cameraLive')}
          className={
            showError
              ? 'absolute inset-0 h-full w-full object-cover blur-[2px] opacity-40'
              : 'absolute inset-0 h-full w-full object-cover'
          }
        />
      )}
      {showError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <CameraOff className="size-8" />
          <span className="text-xs">{t('noSignal')}</span>
        </div>
      ) : (
        !imgUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )
      )}
    </div>
  );
}
