'use client';

import { useEffect, useState, useRef } from 'react';
import { CameraOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Muestra el snapshot de la cámara vía proxy y lo refresca cada N segundos.
 * El proxy /api/cameras/[id]/snapshot evita CORS y cifra la URL real.
 *
 * Usa un contador de fallos consecutivos: sólo muestra "Sin señal" después
 * de 3 intentos fallidos seguidos, evitando parpadeos por errores puntuales.
 */
const FAIL_THRESHOLD = 3;

export function CameraFeed({
  cameraId,
  refreshMs = 5000,
}: {
  cameraId: string;
  refreshMs?: number;
}) {
  const t = useTranslations('cameras');
  const [src, setSrc] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  // Último snapshot válido — se mantiene visible mientras reintenta
  const [lastGoodSrc, setLastGoodSrc] = useState<string | null>(null);
  const failCount = useRef(0);

  useEffect(() => {
    failCount.current = 0;
    setShowError(false);
    setSrc(`/api/cameras/${cameraId}/snapshot?t=${Date.now()}`);

    const interval = setInterval(() => {
      setSrc(`/api/cameras/${cameraId}/snapshot?t=${Date.now()}`);
    }, refreshMs);
    return () => clearInterval(interval);
  }, [cameraId, refreshMs]);

  if (showError) {
    return (
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 text-muted-foreground overflow-hidden">
        {/* Mostrar último snapshot conocido de fondo */}
        {lastGoodSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lastGoodSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover blur-[2px] opacity-40"
          />
        )}
        <CameraOff className="relative size-8" />
        <span className="relative text-xs">{t('noSignal')}</span>
      </div>
    );
  }

  if (!src) {
    return <div className="aspect-video w-full rounded-xl bg-muted/40" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={t('cameraLive')}
      className="aspect-video w-full rounded-xl object-cover"
      onError={() => {
        failCount.current += 1;
        if (failCount.current >= FAIL_THRESHOLD) {
          setShowError(true);
        }
        // Si no alcanza el umbral, el siguiente intervalo cargará un nuevo src
      }}
      onLoad={() => {
        failCount.current = 0;
        setLastGoodSrc(src);
        setShowError(false);
      }}
    />
  );
}
