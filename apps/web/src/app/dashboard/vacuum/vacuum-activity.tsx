'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BatteryMedium, ChevronDown, Clock, History, Loader2, Ruler } from 'lucide-react';

import { humanizeValue, type VacuumSession } from '@/lib/vacuum';
import { getVacuumSessions } from './activity-actions';

/** Relectura mientras la lista está abierta: una sesión en curso avanza sola. */
const REFRESH_MS = 60_000;
const END_STATES = ['docked', 'idle', 'error', 'paused', 'returning', 'cleaning'];

const storageKey = (deviceId: string) => `avyra.vacuum.activity.${deviceId}`;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Registro de limpiezas, plegado por defecto para no comerse la tarjeta.
 * Si el usuario lo deja abierto, se recuerda en ese navegador.
 */
export function VacuumActivity({ deviceId }: { deviceId: string }) {
  const t = useTranslations('vacuum');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<VacuumSession[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Se lee tras montar: en el servidor no hay localStorage y el primer render
  // tiene que coincidir con el suyo.
  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey(deviceId)) === '1') setOpen(true);
    } catch {
      // Almacenamiento bloqueado: se queda plegado.
    }
  }, [deviceId]);

  const load = useCallback(async () => {
    try {
      setSessions(await getVacuumSessions(deviceId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [deviceId]);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, load]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey(deviceId), next ? '1' : '0');
    } catch {
      // Sin almacenamiento sólo se pierde recordar la preferencia.
    }
  }

  const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const areaFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  function dayLabel(date: Date): string {
    const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
    if (diff === 0) return t('activityToday');
    if (diff === 1) return t('activityYesterday');
    return dayFormat.format(date);
  }

  const percent = (value: number | null) => (value === null ? '—' : `${value}%`);

  let body: React.ReactNode;
  if (loadError) {
    body = <p className="px-1 text-xs text-destructive">{t('activityLoadError')}</p>;
  } else if (sessions === null) {
    body = (
      <div className="flex justify-center py-3">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (sessions.length === 0) {
    body = <p className="px-1 text-xs text-muted-foreground">{t('activityEmpty')}</p>;
  } else {
    body = (
      <ul className="styled-scrollbar max-h-60 space-y-1.5 overflow-y-auto pr-1">
        {sessions.map((s) => {
          const start = new Date(s.startedAt);
          const end = s.endedAt ? new Date(s.endedAt) : null;
          const endLabel =
            s.endState && END_STATES.includes(s.endState)
              ? t(`status_${s.endState}` as Parameters<typeof t>[0])
              : s.endState
                ? humanizeValue(s.endState)
                : null;

          return (
            <li key={s.id} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {dayLabel(start)} ·{' '}
                  <span className="tnum">
                    {timeFormat.format(start)}
                    {end && ` – ${timeFormat.format(end)}`}
                  </span>
                </span>
                {end ? (
                  endLabel && <span className="text-muted-foreground">{endLabel}</span>
                ) : (
                  <span className="flex items-center gap-1 text-primary">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    {t('activityInProgress')}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
                <span className="flex items-center gap-1 tnum" title={t('activityDuration')}>
                  <Clock className="size-3" />
                  {s.cleanMinutes === null ? '—' : t('activityMinutes', { count: s.cleanMinutes })}
                </span>
                <span className="flex items-center gap-1 tnum" title={t('activityBattery')}>
                  <BatteryMedium className="size-3" />
                  {percent(s.batteryStart)} → {percent(s.batteryEnd)}
                </span>
                <span
                  className="flex items-center gap-1 tnum"
                  title={s.cleanArea === null ? t('activityAreaUnavailable') : t('activityArea')}
                >
                  <Ruler className="size-3" />
                  {s.cleanArea === null ? '—' : `${areaFormat.format(s.cleanArea)} m²`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="border-t border-border/60 pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <History className="size-3.5" />
          {t('activity')}
        </span>
        <span className="flex items-center gap-1">
          {open ? t('activityHide') : t('activityShow')}
          <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="mt-2">{body}</div>}
    </div>
  );
}
