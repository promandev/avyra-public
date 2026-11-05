'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Clock, History, Loader2, Scale, TriangleAlert } from 'lucide-react';

import {
  classifyVisit,
  nearestCat,
  type LitterCatInfo,
  type LitterCatSummary,
  type LitterDayData,
  type LitterVisitKind,
  type LitterVisitRow,
} from '@/lib/litter';
import { HOME_TIME_ZONE, addDays } from '@/lib/madrid-time';
import { DatePicker } from '../_components/date-picker';
import { correctLitterVisit } from './actions';
import { getLitterDay } from './day-actions';

/** Lo que se guarda de histórico; más atrás no queda nada que ver. */
const HISTORY_DAYS = 365;

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

function CatTile({ row, locale }: { row: LitterCatSummary; locale: string }) {
  const t = useTranslations('litter');
  const name = row.name ?? t('unassigned');
  const missing = row.catId !== null && row.visits === 0;
  const weight =
    row.lastWeightKg === null
      ? null
      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(row.lastWeightKg)} kg`;

  const kinds = [
    row.pee > 0 ? t('peeCount', { count: row.pee }) : null,
    row.poop > 0 ? t('poopCount', { count: row.poop }) : null,
    row.unknown > 0 ? t('unknownCount', { count: row.unknown }) : null,
  ].filter(Boolean);

  return (
    <div
      className={[
        'rounded-xl border px-3 py-2.5',
        missing ? 'border-state-heat/40 bg-state-heat/[0.07]' : 'border-border/60 bg-background/60',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
        {weight && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tnum" title={t('lastWeight')}>
            <Scale className="size-3" />
            {weight}
          </span>
        )}
      </div>
      {missing ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-state-heat-fg">
          <TriangleAlert className="size-3.5" />
          {t('notVisited')}
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-2xl font-semibold leading-tight tnum">
            {row.visits}{' '}
            <span className="text-xs font-normal text-muted-foreground">{t('visitsUnit', { count: row.visits })}</span>
          </p>
          {kinds.length > 0 && <p className="text-xs text-muted-foreground">{kinds.join(' · ')}</p>}
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground tnum">
            <Clock className="size-3" />
            {formatDuration(row.totalSeconds)}
            {row.avgSeconds !== null && ` · ${t('avgTime')} ${formatDuration(row.avgSeconds)}`}
          </p>
        </>
      )}
    </div>
  );
}

const selectClass =
  'min-w-0 rounded-md border border-border bg-background px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50';

function VisitRow({
  visit,
  cats,
  poopMinSeconds,
  timeFormat,
  weightFormat,
  busy,
  onCorrect,
}: {
  visit: LitterVisitRow;
  cats: LitterCatInfo[];
  poopMinSeconds: number;
  timeFormat: Intl.DateTimeFormat;
  weightFormat: Intl.NumberFormat;
  busy: boolean;
  onCorrect: (change: { catId?: string | null; kind?: LitterVisitKind | 'auto' }) => void;
}) {
  const t = useTranslations('litter');
  const kindLabel = (kind: LitterVisitKind) => t(`kind_${kind}`);
  // Lo que saldría sin corrección, para que "Auto" diga qué elegiría.
  const autoCat = cats.find((c) => c.id === nearestCat(visit.weightKg, cats))?.name ?? t('catNone');
  const autoKind = kindLabel(classifyVisit(visit.durationS, poopMinSeconds));

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs">
      <span className="w-11 font-medium tnum">{timeFormat.format(new Date(visit.occurredAt))}</span>
      <select
        aria-label={t('cat')}
        disabled={busy}
        value={visit.catManual ? (visit.catId ?? 'none') : 'auto'}
        onChange={(e) => onCorrect({ catId: e.target.value === 'auto' ? 'auto' : e.target.value === 'none' ? null : e.target.value })}
        className={selectClass}
      >
        <option value="auto">{t('auto', { value: autoCat })}</option>
        {cats.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
        <option value="none">{t('catNone')}</option>
      </select>
      <select
        aria-label={t('kind')}
        disabled={busy}
        value={visit.kindManual ? visit.kind : 'auto'}
        onChange={(e) => onCorrect({ kind: e.target.value as LitterVisitKind | 'auto' })}
        className={selectClass}
      >
        <option value="auto">{t('autoEstimated', { value: autoKind })}</option>
        <option value="pee">{kindLabel('pee')}</option>
        <option value="poop">{kindLabel('poop')}</option>
        <option value="unknown">{kindLabel('unknown')}</option>
      </select>
      <span className="ml-auto flex items-center gap-3 text-muted-foreground tnum">
        <span className="flex items-center gap-1" title={t('duration')}>
          <Clock className="size-3" />
          {formatDuration(visit.durationS)}
        </span>
        <span className="flex items-center gap-1" title={t('weight')}>
          <Scale className="size-3" />
          {visit.weightKg === null ? '—' : `${weightFormat.format(visit.weightKg)} kg`}
        </span>
        {busy && <Loader2 className="size-3 animate-spin" />}
      </span>
    </li>
  );
}

/**
 * Día del arenero: resumen por gato y lista de visitas, con selector de día.
 * Hoy llega ya pintado desde el servidor y se renueva con el refresco de la
 * página; los demás días se piden al elegirlos.
 */
export function LitterDay({
  deviceId,
  cats,
  today,
  initial,
  poopMinSeconds,
}: {
  deviceId: string;
  cats: LitterCatInfo[];
  today: string;
  initial: LitterDayData;
  poopMinSeconds: number;
}) {
  const t = useTranslations('litter');
  const locale = useLocale();
  const router = useRouter();
  const [day, setDay] = useState(today);
  const [other, setOther] = useState<LitterDayData | null>(null);
  const [failedDay, setFailedDay] = useState<string | null>(null);
  const [busyVisit, setBusyVisit] = useState<string | null>(null);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const min = addDays(today, -HISTORY_DAYS);

  const load = useCallback(
    async (target: string) => {
      try {
        const next = await getLitterDay(deviceId, target);
        if (next) setOther(next);
        setFailedDay(next ? null : target);
      } catch {
        setFailedDay(target);
      }
    },
    [deviceId],
  );

  // Otro día, o los gatos cambiaron (el resumen depende de ellos): se pide.
  const catsKey = cats.map((c) => `${c.id}:${c.name}:${c.referenceWeightKg}`).join('|');
  useEffect(() => {
    if (day !== today) void load(day);
  }, [day, today, catsKey, load]);

  // Hoy se alimenta del servidor en cada refresco de la página.
  const data = day === today ? initial : other?.date === day ? other : null;
  const loadError = day !== today && failedDay === day;

  function correct(visitId: string, change: { catId?: string | null; kind?: LitterVisitKind | 'auto' }) {
    setCorrectError(null);
    setBusyVisit(visitId);
    startTransition(async () => {
      const result = await correctLitterVisit(visitId, change);
      if (result.error) setCorrectError(result.error);
      if (day === today) router.refresh();
      else await load(day);
      setBusyVisit(null);
    });
  }

  const dayDate = (() => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  })();
  const dayLabel =
    day === today
      ? t('today')
      : day === addDays(today, -1)
        ? t('yesterday')
        : new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
            dayDate,
          );

  const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: HOME_TIME_ZONE });
  const weightFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  let body: React.ReactNode;
  if (loadError) {
    body = <p className="text-xs text-destructive">{t('loadError')}</p>;
  } else if (!data) {
    body = (
      <div className="flex justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {data.summary.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.summary.map((row) => (
              <CatTile key={row.catId ?? 'none'} row={row} locale={locale} />
            ))}
          </div>
        )}
        {data.visits.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t('noVisits')}</p>
        ) : (
          <ul className="styled-scrollbar max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {[...data.visits].reverse().map((visit) => (
              <VisitRow
                key={visit.id}
                visit={visit}
                cats={cats}
                poopMinSeconds={poopMinSeconds}
                timeFormat={timeFormat}
                weightFormat={weightFormat}
                busy={busyVisit === visit.id}
                onCorrect={(change) => correct(visit.id, change)}
              />
            ))}
          </ul>
        )}
        {correctError && <p className="text-xs text-destructive">{correctError}</p>}
      </div>
    );
  }

  return (
    <section className="space-y-3 border-t border-border/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold first-letter:uppercase">
          <History className="size-4 text-muted-foreground" />
          {dayLabel}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDay(addDays(day, -1))}
            disabled={day <= min}
            aria-label={t('prevDay')}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <DatePicker value={day} onChange={setDay} min={min} max={today} />
          <button
            type="button"
            onClick={() => setDay(addDays(day, 1))}
            disabled={day >= today}
            aria-label={t('nextDay')}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      {cats.length === 0 && <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t('noCatsHint')}</p>}
      {body}
    </section>
  );
}
