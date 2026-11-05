'use client';

import { useState, useEffect, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Loader2, Calendar, House, Leaf, Sparkles, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { VACUUM_CLEAN_MODES, type VacuumCleanMode } from '@/lib/vacuum';
import {
  getVacuumSchedules,
  addVacuumSchedule,
  deleteVacuumSchedule,
  type VacuumSchedule,
} from './schedule-actions';

interface VacuumInfo {
  id: string;
  name: string;
  haEntityId: string | null;
}

const DAY_COUNT = 7;
const PRESETS = [
  { labelKey: 'schedulePresetWeekdays', days: [0, 1, 2, 3, 4] },
  { labelKey: 'schedulePresetWeekend', days: [5, 6] },
  { labelKey: 'schedulePresetAll', days: [0, 1, 2, 3, 4, 5, 6] },
] as const;

const MODE_ICONS: Record<VacuumCleanMode, typeof Leaf> = { auto: Sparkles, eco: Leaf };
const MODE_LABEL_KEYS: Record<VacuumCleanMode, 'modeAuto' | 'modeEco'> = { auto: 'modeAuto', eco: 'modeEco' };

function DayChips({ daysOfWeek, dayLabels }: { daysOfWeek: number[]; dayLabels: string[] }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: DAY_COUNT }, (_, i) => (
        <span
          key={i}
          className={[
            'inline-flex h-5 min-w-[18px] items-center justify-center rounded px-0.5 text-[10px] font-semibold',
            daysOfWeek.includes(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground/50',
          ].join(' ')}
        >
          {dayLabels[i]}
        </span>
      ))}
    </div>
  );
}

export function VacuumScheduleModal({ vacuum, onClose }: { vacuum: VacuumInfo; onClose: () => void }) {
  const t = useTranslations('vacuum');

  const [schedules, setSchedules] = useState<VacuumSchedule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedDays, setSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [startTime, setStartTime] = useState('10:00');
  const [withEnd, setWithEnd] = useState(true);
  const [endTime, setEndTime] = useState('11:30');
  const [mode, setMode] = useState<VacuumCleanMode>('auto');
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dayLabels = Array.from({ length: DAY_COUNT }, (_, i) => t(`scheduleDay${i}` as Parameters<typeof t>[0]));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    getVacuumSchedules(vacuum.id)
      .then((data) => {
        if (alive) {
          setSchedules(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setLoadError(t('loadError'));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [vacuum.id, t]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function toggleDay(day: number) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function handleAdd() {
    if (selectedDays.length === 0) {
      setFormError(t('slotNoDays'));
      return;
    }
    if (!startTime || (withEnd && !endTime)) {
      setFormError(t('slotInvalidData'));
      return;
    }
    if (withEnd && endTime <= startTime) {
      setFormError(t('slotEndBeforeStart'));
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const result = await addVacuumSchedule(vacuum.id, {
        daysOfWeek: selectedDays,
        startTime,
        endTime: withEnd ? endTime : null,
        cleanMode: mode,
      });
      if (result.error) {
        setFormError(result.error);
      } else if (result.schedule) {
        setSchedules((prev) =>
          [...(prev ?? []), result.schedule!].sort((a, b) => a.startTime.localeCompare(b.startTime)),
        );
      }
    });
  }

  function handleDelete(scheduleId: string) {
    startTransition(async () => {
      const result = await deleteVacuumSchedule(scheduleId);
      if (result.error) setFormError(result.error);
      else setSchedules((prev) => (prev ?? []).filter((s) => s.id !== scheduleId));
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="relative flex w-full max-w-lg flex-col rounded-2xl bg-card shadow-2xl max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              <div>
                <h2 className="text-base font-semibold leading-tight">{t('scheduleTitle')}</h2>
                <p className="text-xs text-muted-foreground">{vacuum.name}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent transition">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                {loadError}
              </div>
            ) : (schedules ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t('noSlots')}</p>
            ) : (
              <ul className="space-y-2">
                {(schedules ?? []).map((s) => {
                  const ModeIcon = MODE_ICONS[s.cleanMode];
                  return (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-4 py-2.5"
                    >
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <DayChips daysOfWeek={s.daysOfWeek} dayLabels={dayLabels} />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">
                            {s.startTime}
                            {s.endTime && ` – ${s.endTime}`}
                          </span>
                          <span className="flex items-center gap-1 text-sm">
                            <ModeIcon className="size-3.5 text-primary" />
                            {t(MODE_LABEL_KEYS[s.cleanMode])}
                          </span>
                          {s.endTime && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <House className="size-3" />
                              {s.endTime}
                            </span>
                          )}
                          {!s.haAutomationId && (
                            <span className="rounded bg-state-heat/15 px-1.5 py-0.5 text-[10px] text-state-heat-fg">
                              {t('scheduleNoHa')}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleDelete(s.id)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition disabled:opacity-50"
                        title={t('deleteSlot')}
                      >
                        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">{t('addSlot')}</p>

              <div className="space-y-1.5">
                <div className="flex gap-1">
                  {Array.from({ length: DAY_COUNT }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={[
                        'flex h-8 flex-1 items-center justify-center rounded-md text-xs font-medium transition',
                        selectedDays.includes(i)
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border bg-background text-muted-foreground hover:bg-accent',
                      ].join(' ')}
                    >
                      {dayLabels[i]}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.labelKey}
                      type="button"
                      onClick={() => setSelectedDays([...p.days])}
                      className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent transition"
                    >
                      {t(p.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">{t('scheduleMode')}</p>
                <div className="flex flex-wrap gap-1">
                  {VACUUM_CLEAN_MODES.map((m) => {
                    const Icon = MODE_ICONS[m];
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={[
                          'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                          mode === m
                            ? 'border-primary/60 bg-primary/15 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:bg-accent',
                        ].join(' ')}
                      >
                        <Icon className="size-3" />
                        {t(MODE_LABEL_KEYS[m])}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="vacuum-slot-start">
                    {t('scheduleStart')}
                  </label>
                  <input
                    id="vacuum-slot-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="vacuum-slot-end">
                    {t('scheduleEnd')}
                  </label>
                  <input
                    id="vacuum-slot-end"
                    type="time"
                    value={endTime}
                    disabled={!withEnd}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={withEnd}
                    onChange={(e) => setWithEnd(e.target.checked)}
                    className="size-3.5 accent-primary"
                  />
                  {t('scheduleEndToggle')}
                </label>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleAdd}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {t('addSlot')}
                </button>
              </div>
              {formError && <p className="text-xs text-destructive">{formError}</p>}
            </div>
          </div>

          <div className="border-t border-border px-5 py-3 shrink-0">
            <p className="text-xs text-muted-foreground">
              {vacuum.haEntityId ? t('scheduleHaInfo') : t('scheduleNoHaWarning')}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
