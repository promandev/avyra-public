'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from 'next-intl';

/**
 * Calendario de bolsillo para elegir un día ('YYYY-MM-DD').
 *
 * Sale del de la grabadora de cámaras, pero trabaja con días de calendario y no
 * con `Date` locales: el día que se elige es el de casa, venga de donde venga el
 * navegador. Las fechas sólo pasan por `Date` en UTC, para el día de la semana y
 * los nombres.
 */

const toDay = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function parseDay(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y!, m! - 1, d!];
}

/** Altura aproximada del calendario, para abrirlo hacia arriba si no cabe. */
const POPUP_HEIGHT = 290;

export function DatePicker({
  value,
  onChange,
  min,
  max,
  today = max,
}: {
  value: string;
  onChange: (day: string) => void;
  min?: string;
  max?: string;
  /** Día que se marca con un punto; por defecto el máximo. */
  today?: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const [selYear, selMonth, selDay] = parseDay(value);
  const [viewYear, setViewYear] = useState(selYear);
  const [viewMonth, setViewMonth] = useState(selMonth);

  // Si el día cambia desde fuera (flechas de día anterior/siguiente), el
  // calendario salta a su mes.
  const [shownValue, setShownValue] = useState(value);
  if (shownValue !== value) {
    setShownValue(value);
    setViewYear(selYear);
    setViewMonth(selMonth);
  }

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const style: React.CSSProperties = {
      position: 'fixed',
      right: Math.max(8, window.innerWidth - rect.right),
      zIndex: 9999,
    };
    if (spaceBelow >= POPUP_HEIGHT || spaceBelow >= rect.top) style.top = rect.bottom + 4;
    else style.bottom = window.innerHeight - rect.top + 4;
    setPopupStyle(style);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const outOfRange = (day: string) => (min !== undefined && day < min) || (max !== undefined && day > max);

  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  // Lunes primero: getUTCDay() da 0 = domingo.
  const firstOffset = (new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay() + 6) % 7;

  const display = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(selYear, selMonth, selDay)));

  // El 1 de enero de 2024 fue lunes.
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' }).format(
      new Date(Date.UTC(2024, 0, 1 + i)),
    ),
  );
  const monthLabel = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(viewYear, viewMonth, 1)));

  const canGoPrev = min === undefined || toDay(viewYear, viewMonth, 1) > min;
  const canGoNext = max === undefined || toDay(viewYear, viewMonth, daysInMonth) < max;

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  }

  return (
    <div ref={triggerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition hover:bg-accent"
      >
        <CalendarDays className="size-3.5 text-muted-foreground" />
        {display}
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>

      {open &&
        createPortal(
          <div ref={popupRef} style={popupStyle} className="w-64 rounded-xl border border-border bg-card p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                disabled={!canGoPrev}
                className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-xs font-semibold capitalize">{monthLabel}</span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                disabled={!canGoNext}
                className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7">
              {weekdayLabels.map((label, i) => (
                <div key={i} className="py-1 text-center text-[10px] font-medium text-muted-foreground">
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {Array.from({ length: firstOffset }, (_, i) => (
                <div key={`pad-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const dayNumber = i + 1;
                const day = toDay(viewYear, viewMonth, dayNumber);
                const isSel = day === value;
                const isToday = day === today;
                const disabled = outOfRange(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(day);
                      setOpen(false);
                    }}
                    className={[
                      'relative flex select-none items-center justify-center rounded-md py-1.5 text-xs transition',
                      disabled ? 'cursor-not-allowed opacity-25' : 'cursor-pointer hover:bg-accent',
                      isSel
                        ? 'bg-primary font-semibold text-primary-foreground hover:bg-primary'
                        : isToday
                          ? 'font-semibold text-primary'
                          : '',
                    ].join(' ')}
                  >
                    {dayNumber}
                    {isToday && !isSel && (
                      <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary" />
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
