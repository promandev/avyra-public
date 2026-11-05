'use client';

import { useState, useEffect, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Loader2, Calendar, Flame, PowerOff, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ValueWheel } from '@/components/value-wheel';
import {
  getSchedules,
  addSchedule,
  deleteSchedule,
  clearAllSchedules,
  deleteHaOnlySchedule,
  type Schedule,
} from './schedule-actions';

interface ThermostatInfo {
  id: string;
  name: string;
  haEntityId: string | null;
  temperatureScale: number;
}

const DAY_COUNT = 7;

/** De 15 a 28 °C en pasos de 0,5: lo razonable para una consigna en casa. */
const TEMP_VALUES = Array.from({ length: (28 - 15) / 0.5 + 1 }, (_, i) => 15 + i * 0.5);
const PRESETS = [
  { labelKey: 'schedulePresetWeekdays', days: [0, 1, 2, 3, 4] },
  { labelKey: 'schedulePresetWeekend', days: [5, 6] },
  { labelKey: 'schedulePresetAll', days: [0, 1, 2, 3, 4, 5, 6] },
] as const;

function DayChips({
  daysOfWeek,
  dayLabels,
}: {
  daysOfWeek: number[];
  dayLabels: string[];
}) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: DAY_COUNT }, (_, i) => {
        const active = daysOfWeek.includes(i);
        return (
          <span
            key={i}
            className={[
              'inline-flex h-5 min-w-[18px] items-center justify-center rounded px-0.5 text-[10px] font-semibold',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground/50',
            ].join(' ')}
          >
            {dayLabels[i]}
          </span>
        );
      })}
    </div>
  );
}

export function ScheduleModal({
  thermostat,
  onClose,
}: {
  thermostat: ThermostatInfo;
  onClose: () => void;
}) {
  const t = useTranslations('heating');

  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-slot form
  const [selectedDays, setSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [newTime, setNewTime] = useState('07:00');
  const [newTemp, setNewTemp] = useState(21);
  const [newMode, setNewMode] = useState<'heat' | 'off'>('heat');
  const [formError, setFormError] = useState<string | null>(null);
  const [clearNote, setClearNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dayLabels = Array.from({ length: DAY_COUNT }, (_, i) => t(`scheduleDay${i}` as Parameters<typeof t>[0]));

  // Load schedules on mount with error handling
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    getSchedules(thermostat.id)
      .then((data) => {
        if (!alive) return;
        setSchedules(data.schedules);
        if (data.error) setLoadError(data.error);
        setLoading(false);
      })
      .catch((err) => {
        if (alive) {
          setLoadError(err instanceof Error ? err.message : 'Error al cargar programaciones');
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [thermostat.id]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function toggleDay(day: number) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function applyPreset(days: readonly number[]) {
    setSelectedDays([...days]);
  }

  function handleAdd() {
    if (selectedDays.length === 0) { setFormError(t('slotNoDays')); return; }
    const temperature = newMode === 'heat' ? newTemp : null;
    if (!newTime) { setFormError(t('slotInvalidData')); return; }
    if (newMode === 'heat' && (temperature === null || !Number.isFinite(temperature) || temperature < 1)) {
      setFormError(t('slotInvalidData')); return;
    }
    setFormError(null);
    startTransition(async () => {
      const result = await addSchedule(thermostat.id, {
        daysOfWeek: selectedDays,
        startTime: newTime,
        temperature,
        hvacMode: newMode,
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

  function handleClearAll() {
    if (!window.confirm(t('clearAllConfirm'))) return;
    setClearNote(null);
    startTransition(async () => {
      const result = await clearAllSchedules(thermostat.id);
      if (result.error) {
        setClearNote(result.error);
        return;
      }
      setSchedules([]);
      setLoadError(null);
      const parts = [t('clearAllDone', { count: result.removed ?? 0 })];
      if (result.manualMode) parts.push(t('clearAllManual'));
      setClearNote(parts.join(' '));
    });
  }

  function handleDelete(scheduleId: string) {
    const haOnly = schedules?.find((s) => s.id === scheduleId)?.haOnly;
    startTransition(async () => {
      const result = haOnly
        ? await deleteHaOnlySchedule(thermostat.id, scheduleId)
        : await deleteSchedule(scheduleId);
      if (!result.error) {
        setSchedules((prev) => (prev ?? []).filter((s) => s.id !== scheduleId));
      }
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="relative flex w-full max-w-lg flex-col rounded-t-2xl rounded-b-none md:rounded-2xl bg-card shadow-2xl max-h-[90dvh] animate-sheet-up md:animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="md:hidden mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden />
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              <div>
                <h2 className="text-base font-semibold leading-tight">{t('scheduleTitle')}</h2>
                <p className="text-xs text-muted-foreground">{thermostat.name}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent transition">
              <X className="size-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Schedule list */}
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
                {(schedules ?? []).map((s) => (
                  <li key={s.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 px-4 py-2.5 gap-3">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <DayChips daysOfWeek={s.daysOfWeek} dayLabels={dayLabels} />
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-sm font-semibold">{s.startTime}</span>
                        <span className="text-muted-foreground">→</span>
                        {s.hvacMode === 'off' ? (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <PowerOff className="size-3.5" />{t('scheduleModeOff')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-sm">
                            <Flame className="size-3.5 text-state-heat" />
                            {s.temperature != null ? `${s.temperature.toFixed(1)}°C` : t('scheduleModeHeat')}
                          </span>
                        )}
                        {s.haOnly && (
                          <span
                            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
                            title={t('scheduleHaOnlyHint')}
                          >
                            {t('scheduleHaOnly')}
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
                ))}
              </ul>
            )}

            {/* Add form */}
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">{t('addSlot')}</p>

              {/* Day multi-selector */}
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
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.labelKey}
                      type="button"
                      onClick={() => applyPreset(p.days)}
                      className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent transition"
                    >
                      {t(p.labelKey as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode selector */}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setNewMode('heat')}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition',
                    newMode === 'heat'
                      ? 'border-state-heat/60 bg-state-heat/15 text-state-heat-fg'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent',
                  ].join(' ')}
                >
                  <Flame className="size-3.5" />{t('scheduleModeHeat')}
                </button>
                <button
                  type="button"
                  onClick={() => setNewMode('off')}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition',
                    newMode === 'off'
                      ? 'border-slate-500/60 bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent',
                  ].join(' ')}
                >
                  <PowerOff className="size-3.5" />{t('scheduleModeOff')}
                </button>
              </div>

              {/* Hora + temperatura. La hora va en un <input type="time"> nativo
                  (en móvil abre la ruleta del sistema) con el texto centrado
                  también en su parte interna de WebKit; la temperatura, en una
                  ruleta propia limitada a lo que tiene sentido en casa. Texto a
                  16 px en móvil para que Safari no haga zoom al enfocar. */}
              <div className={newMode === 'heat' ? 'grid grid-cols-2 items-center gap-3' : ''}>
                <div className="min-w-0 space-y-1">
                  <label className="block text-center text-[11px] text-muted-foreground" htmlFor="slot-time">
                    {t('slotTime')}
                  </label>
                  <input
                    id="slot-time"
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="block h-11 w-full min-w-0 appearance-none rounded-md border border-border bg-background px-2 text-center font-mono text-lg font-semibold tnum outline-none focus:ring-2 focus:ring-primary/50 [&::-webkit-date-and-time-value]:text-center [&::-webkit-datetime-edit]:justify-center"
                  />
                </div>
                {newMode === 'heat' && (
                  <div className="min-w-0 space-y-1">
                    <p className="text-center text-[11px] text-muted-foreground">{t('slotTemp')}</p>
                    <ValueWheel
                      values={TEMP_VALUES}
                      value={newTemp}
                      onChange={setNewTemp}
                      format={(v) => `${v.toFixed(1)}°`}
                      label={t('slotTemp')}
                      accentClassName="border-state-heat/40 bg-state-heat/10"
                      selectedClassName="text-state-heat-fg"
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={handleAdd}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {t('addSlot')}
              </button>
              {formError && <p className="text-xs text-destructive">{formError}</p>}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-5 py-3 shrink-0 space-y-2">
            {clearNote && <p className="text-xs text-foreground/80">{clearNote}</p>}
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {thermostat.haEntityId ? t('scheduleHaInfo') : t('scheduleNoHaWarning')}
              </p>
              <button
                type="button"
                disabled={isPending}
                onClick={handleClearAll}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                title={t('clearAllHint')}
              >
                {t('clearAll')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
