import type { ClimateOverview } from '@/lib/home-pulse-types';

/**
 * Dial de temperatura de una estancia.
 *
 * Un arco de 270° con la temperatura del cuarto como relleno y una marca en la
 * consigna. De un vistazo se ve lo que importa: cuánto falta para llegar. El
 * color sólo se enciende cuando el aparato está dando servicio, que es la
 * misma regla que tiñe el fondo; si está encendido pero en espera, el arco se
 * queda neutro.
 */

/** Escala fija para todos los diales, así se pueden comparar entre sí. */
const MIN_C = 10;
const MAX_C = 30;

const SIZE = 132;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const SWEEP = 0.75; // 270°
const START_DEG = 135; // el hueco queda abajo

function fraction(value: number): number {
  return Math.min(1, Math.max(0, (value - MIN_C) / (MAX_C - MIN_C)));
}

/* Clases literales: Tailwind tiene que poder verlas enteras. */
const ARC_TONE = {
  heat: 'stroke-state-heat drop-shadow-[0_0_6px_hsl(var(--state-heat)/0.55)]',
  cool: 'stroke-state-cool drop-shadow-[0_0_6px_hsl(var(--state-cool)/0.55)]',
  standby: 'stroke-foreground/45',
  off: 'stroke-muted-foreground/25',
};

export function ClimateDial({
  device,
  labels,
  locale,
}: {
  device: ClimateOverview;
  labels: { running: string; standby: string; off: string; noData: string; target: string };
  locale: string;
}) {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const hasReading = device.current !== null;

  const tone = !device.power ? 'off' : device.running ? device.kind : 'standby';
  const status = !hasReading
    ? labels.noData
    : !device.power
      ? labels.off
      : device.running
        ? labels.running
        : labels.standby;

  const filled = hasReading ? fraction(device.current!) : 0;
  const center = SIZE / 2;

  // Marca de consigna: un punto sobre el arco en su ángulo.
  let marker: { x: number; y: number } | null = null;
  if (device.target !== null && device.power) {
    const deg = START_DEG + 360 * SWEEP * fraction(device.target);
    const rad = (deg * Math.PI) / 180;
    marker = { x: center + R * Math.cos(rad), y: center + R * Math.sin(rad) };
  }

  const chipTone =
    tone === 'heat'
      ? 'bg-state-heat/15 text-state-heat-fg'
      : tone === 'cool'
        ? 'bg-state-cool/15 text-state-cool-fg'
        : 'bg-muted/60 text-muted-foreground';

  return (
    <figure className="flex min-w-[9.5rem] flex-col items-center gap-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" aria-hidden="true">
          <g transform={`rotate(${START_DEG} ${center} ${center})`}>
            {/* Pista */}
            <circle
              cx={center}
              cy={center}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              className="stroke-muted"
              strokeDasharray={`${CIRC * SWEEP} ${CIRC}`}
            />
            {/* Temperatura del cuarto */}
            {hasReading && (
              <circle
                cx={center}
                cy={center}
                r={R}
                fill="none"
                strokeWidth={STROKE}
                strokeLinecap="round"
                className={`transition-all duration-700 ${ARC_TONE[tone]}`}
                strokeDasharray={`${CIRC * SWEEP * filled} ${CIRC}`}
              />
            )}
          </g>
          {marker && (
            <circle
              cx={marker.x}
              cy={marker.y}
              r={5}
              className="fill-card stroke-foreground"
              strokeWidth={2.5}
            />
          )}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-3xl font-semibold leading-none tracking-tight">
            {hasReading ? `${fmt.format(device.current!)}°` : '—'}
          </span>
          {device.target !== null && device.power && (
            <span className="tnum mt-1 text-xs text-muted-foreground">
              {labels.target.replace('{temp}', fmt.format(device.target))}
            </span>
          )}
        </div>
      </div>

      <figcaption className="flex flex-col items-center gap-1.5 text-center">
        <span className="max-w-[9rem] truncate text-sm font-medium">{device.name}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chipTone}`}>{status}</span>
      </figcaption>
    </figure>
  );
}
