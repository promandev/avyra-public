'use client';

import { useEffect, useRef } from 'react';

/** Alto de cada fila; el scroll-snap y el cálculo del índice dependen de él. */
const ITEM_PX = 36;
/** Filas visibles: la central es la seleccionada y dos por arriba y por abajo. */
const VISIBLE = 5;
const PAD_PX = ((VISIBLE - 1) / 2) * ITEM_PX;

/**
 * Ruleta vertical al estilo del selector de hora de iOS: se arrastra (o se
 * rueda con el ratón) y el valor que queda en la franja central es el elegido.
 *
 * El scroll lo hace el navegador con scroll-snap, así que en móvil tiene la
 * inercia nativa. El valor se publica en cada evento de scroll; el scroll
 * programático sólo se hace cuando el valor cambia desde fuera, para no
 * pelearse con el dedo.
 */
export function ValueWheel({
  values,
  value,
  onChange,
  format,
  label,
  accentClassName = 'bg-primary/10 border-primary/30',
  selectedClassName = 'text-primary',
}: {
  values: readonly number[];
  value: number;
  onChange: (next: number) => void;
  format: (v: number) => string;
  label: string;
  /** Fondo y borde de la franja central. */
  accentClassName?: string;
  /** Color del valor seleccionado. */
  selectedClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(0, values.indexOf(value));
  // Último índice que salió de un scroll del usuario: si el valor de fuera ya
  // coincide, no hay que mover nada.
  const fromScroll = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || fromScroll.current === index) return;
    el.scrollTo({ top: index * ITEM_PX, behavior: fromScroll.current === null ? 'instant' : 'smooth' });
    fromScroll.current = index;
  }, [index]);

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_PX)));
    if (i !== fromScroll.current) {
      fromScroll.current = i;
      onChange(values[i]!);
    }
  }

  function step(delta: number) {
    const i = Math.min(values.length - 1, Math.max(0, index + delta));
    if (i !== index) onChange(values[i]!);
  }

  return (
    <div className="relative h-[180px] w-full overflow-hidden rounded-md border border-border bg-background">
      {/* Franja de selección, detrás de los números. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-1.5 top-1/2 h-9 -translate-y-1/2 rounded-md border ${accentClassName}`}
      />
      <div
        ref={ref}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={values[0]}
        aria-valuemax={values[values.length - 1]}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onScroll={handleScroll}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
        }}
        className="relative h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-scrollbar]:hidden"
        style={{
          paddingBlock: PAD_PX,
          maskImage: 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
        }}
      >
        {values.map((v, i) => {
          const distance = Math.abs(i - index);
          return (
            <button
              key={v}
              type="button"
              tabIndex={-1}
              onClick={() => onChange(v)}
              className={[
                'flex w-full snap-center items-center justify-center tnum transition-[color,font-size,opacity] duration-150',
                distance === 0
                  ? `text-lg font-semibold ${selectedClassName}`
                  : distance === 1
                    ? 'text-sm text-foreground/70'
                    : 'text-xs text-muted-foreground/60',
              ].join(' ')}
              style={{ height: ITEM_PX }}
            >
              {format(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
