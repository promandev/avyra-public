'use client';

import { useEffect, useId, useRef } from 'react';
import { Umbrella } from 'lucide-react';

import type { HourlyPoint } from '@/lib/weather';

// ─── Geometry constants (SVG user units) ─────────────────────────────────────

const W = 720;
const H = 240;
const PAD_L = 28;
const PAD_R = 28;
const PAD_TOP = 44; // room for temperature labels above the curve
const AXIS_Y = H - 40; // baseline where hour labels + rain bars sit
const RAIN_MAX_H = 56; // max pixel height of a 100 % rain bar

interface Pt {
  x: number;
  y: number;
}

/**
 * Builds a smooth (Catmull-Rom → cubic-bezier) path through the given points,
 * giving the temperature curve its rounded, bell-like shape.
 */
function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;

  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

interface WeatherDayChartProps {
  points: HourlyPoint[];
  /** Local "now" timestamp, e.g. "2026-05-31T14:30" — highlights the current hour. */
  currentTime: string;
  labels: {
    title: string;
    now: string;
    chanceOfRain: string;
  };
}

export function WeatherDayChart({ points, currentTime, labels }: WeatherDayChartProps) {
  const gradId = useId();
  const rainGradId = useId();
  const scrollerRef = useRef<HTMLDivElement>(null);

  // ── Current-hour anchor ─────────────────────────────────────────────────────
  // Se calcula antes del early-return para no romper el orden de los hooks.
  const currentHourKey = currentTime.slice(0, 13);
  const nowIdx = points.findIndex((p) => p.time.slice(0, 13) === currentHourKey);

  // En móvil el gráfico no cabe entero y se desplaza. Al abrirlo lo dejamos
  // centrado en la hora actual: de nada sirve empezar mirando la madrugada
  // cuando son las siete de la tarde.
  //
  // No basta con hacerlo una vez al montar. En ese instante el contenedor
  // puede no tener todavía su ancho definitivo (la tarjeta entra con una
  // animación, y la fuente puede seguir cargando), así que `scrollWidth` y
  // `clientWidth` mienten y el cálculo sale mal o se descarta por creer que
  // no hay desbordamiento. Se reintenta tras el primer fotograma y se observa
  // el tamaño hasta lograrlo, momento en el que se deja de mirar para no
  // pelear con el dedo del usuario.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || nowIdx < 0 || points.length < 2) return;

    let done = false;

    const place = () => {
      if (done) return;
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow <= 4) return; // cabe entero: no hay nada que centrar
      const ratio = (PAD_L + (nowIdx / (points.length - 1)) * (W - PAD_L - PAD_R)) / W;
      const target = ratio * el.scrollWidth - el.clientWidth / 2;
      el.scrollLeft = Math.min(Math.max(target, 0), overflow);
      done = true;
    };

    place();
    const raf = requestAnimationFrame(place);
    const observer = new ResizeObserver(place);
    observer.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [nowIdx, points.length]);

  if (points.length < 2) return null;

  // ── Scales ────────────────────────────────────────────────────────────────
  const temps = points.map((p) => p.temperature);
  let minT = Math.min(...temps);
  let maxT = Math.max(...temps);
  if (minT === maxT) {
    // Flat day — give the curve a little breathing room
    minT -= 1;
    maxT += 1;
  }
  const span = maxT - minT;

  const innerW = W - PAD_L - PAD_R;
  const stepX = innerW / (points.length - 1);
  const xOf = (i: number) => PAD_L + i * stepX;
  const yOf = (t: number) => PAD_TOP + (1 - (t - minT) / span) * (AXIS_Y - PAD_TOP);

  const curve: Pt[] = points.map((p, i) => ({ x: xOf(i), y: yOf(p.temperature) }));
  const linePath = smoothPath(curve);
  const areaPath = `${linePath} L ${curve[curve.length - 1]!.x} ${AXIS_Y} L ${curve[0]!.x} ${AXIS_Y} Z`;

  // ── Min / max markers ───────────────────────────────────────────────────────
  const maxIdx = temps.indexOf(maxT);
  const minIdx = temps.indexOf(minT);

  const hasRain = points.some((p) => p.precipitationProbability > 0);

  return (
    <div className="w-full">
      {/*
        En pantallas estrechas el gráfico conservaba el ancho del contenedor y
        se encogía entero: las etiquetas quedaban en 6 px, ilegibles. Ahora se
        le pone un ancho mínimo igual al del viewBox, de modo que en móvil sale
        a tamaño natural y se desplaza en horizontal, y en escritorio sigue
        ocupando todo el ancho porque ya supera ese mínimo.
      */}
      <div ref={scrollerRef} className="styled-scrollbar -mx-1 overflow-x-auto px-1 pb-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[720px] select-none"
          role="img"
          aria-label={labels.title}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'hsl(var(--state-heat))', stopOpacity: 0.35 }} />
              <stop offset="100%" style={{ stopColor: 'hsl(var(--state-heat))', stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient id={rainGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'hsl(var(--state-cool))', stopOpacity: 0.65 }} />
              <stop offset="100%" style={{ stopColor: 'hsl(var(--state-cool))', stopOpacity: 0.15 }} />
            </linearGradient>
          </defs>

          {/* Rain probability bars (behind the temperature curve) */}
          {points.map((p, i) => {
            if (p.precipitationProbability <= 0) return null;
            const barH = (p.precipitationProbability / 100) * RAIN_MAX_H;
            const bw = Math.max(stepX * 0.5, 4);
            return (
              <rect
                key={`rain-${p.time}`}
                x={xOf(i) - bw / 2}
                y={AXIS_Y - barH}
                width={bw}
                height={barH}
                rx={2}
                fill={`url(#${rainGradId})`}
              />
            );
          })}

          {/* Baseline */}
          <line
            x1={PAD_L}
            y1={AXIS_Y}
            x2={W - PAD_R}
            y2={AXIS_Y}
            stroke="currentColor"
            strokeOpacity="0.12"
            strokeWidth="1"
          />

          {/* Temperature area + curve */}
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            className="stroke-state-heat"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Current-hour marker */}
          {nowIdx >= 0 && (
            <g>
              <line
                x1={xOf(nowIdx)}
                y1={PAD_TOP - 10}
                x2={xOf(nowIdx)}
                y2={AXIS_Y}
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={xOf(nowIdx)}
                cy={curve[nowIdx]!.y}
                r="5"
                className="fill-state-heat"
                style={{ stroke: 'hsl(var(--card))' }}
                strokeWidth="2.5"
              />
            </g>
          )}

          {/* Max temperature label */}
          <text
            x={xOf(maxIdx)}
            y={curve[maxIdx]!.y - 13}
            textAnchor="middle"
            className="fill-foreground"
            fontSize="15"
            fontWeight="600"
          >
            {maxT}°
          </text>

          {/* Min temperature label (skip if it collides with max).
              Si la mínima cae pegada al eje, la etiqueta se pone encima del
              punto en vez de debajo: si no, se monta sobre las horas. */}
          {minIdx !== maxIdx &&
            (() => {
              const below = curve[minIdx]!.y + 22;
              const y = below > AXIS_Y - 4 ? curve[minIdx]!.y - 12 : below;
              return (
                <text
                  x={xOf(minIdx)}
                  y={y}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="14"
                >
                  {minT}°
                </text>
              );
            })()}

          {/* Hour axis labels — cada 2 horas, que a tamaño natural caben */}
          {points.map((p, i) => {
            if (i % 2 !== 0 && i !== nowIdx) return null;
            const isNow = i === nowIdx;
            return (
              <text
                key={`h-${p.time}`}
                x={xOf(i)}
                y={H - 13}
                textAnchor="middle"
                className={isNow ? 'fill-foreground' : 'fill-muted-foreground'}
                fontSize="12"
                fontWeight={isNow ? 600 : 400}
              >
                {isNow ? labels.now : p.time.slice(11, 13)}
              </text>
            );
          })}
        </svg>
      </div>

      {hasRain && (
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-state-cool">
          <Umbrella className="size-2.5" />
          <span>{labels.chanceOfRain}</span>
        </div>
      )}
    </div>
  );
}
