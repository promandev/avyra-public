'use client';

import { useState, useEffect, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Loader2, Calendar, Snowflake, PowerOff, Wind, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getAcSchedules, addAcSchedule, deleteAcSchedule, type AcSchedule } from './schedule-actions';

interface AcInfo {
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

const FAN_MODES = ['quiet', 'low', 'medium_low', 'medium', 'medium_high', 'high', 'auto'] as const;
const HVAC_MODES = ['cool', 'heat', 'fan_only', 'dry', 'off'] as const;

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

export function AcScheduleModal({
  ac,
  onClose,
}: {
  ac: AcInfo;
  onClose: () => void;
}) {
  const t = useTranslations('ac');

  const [schedules, setSchedules] = useState<AcSchedule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedDays, setSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [newTime, setNewTime] = useState('07:00');
  const [newTemp, setNewTemp] = useState('');
  const [newMode, setNewMode] = useState<string>('cool');
  const [newFanMode, setNewFanMode] = useState<string>('auto');
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dayLabels = Array.from({ length: DAY_COUNT }, (_, i) => t(`scheduleDay${i}` as Parameters<typeof t>[0]));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    getAcSchedules(ac.id)
      .then((data) => {
        if (alive) { setSchedules(data); setLoading(false); }
      })
      .catch((err) => {
        if (alive) {
          setLoadError(err instanceof Error ? err.message : 'Error al cargar programaciones');
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [ac.id]);

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
    const temperature = newMode !== 'off' && newMode !== 'fan_only' ? parseFloat(newTemp.replace(',', '.')) : null;
    if (!newTime) { setFormError(t('slotInvalidData')); return; }
    if (newMode !== 'off' && newMode !== 'fan_only' && (temperature === null || !Number.isFinite(temperature) || temperature < 10 || temperature > 35)) {
      setFormError(t('slotInvalidData')); return;
    }
    setFormError(null);
    startTransition(async () => {
      const result = await addAcSchedule(ac.id, {
        daysOfWeek: selectedDays,
        startTime: newTime,
        temperature,
        hvacMode: newMode,
        fanMode: newMode !== 'off' ? newFanMode : null,
      });
      if (result.error) {
        setFormError(result.error);
      } else if (result.schedule) {
        setSchedules((prev) =>
          [...(prev ?? []), result.schedule!].sort((a, b) => a.startTime.localeCompare(b.startTime)),
        );
        setNewTemp('');
      }
    });
  }

  function handleDelete(scheduleId: string) {
    startTransition(async () => {
      const result = await deleteAcSchedule(scheduleId);
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
          className="relative flex w-full max-w-lg flex-col rounded-2xl bg-card shadow-2xl max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              <div>
                <h2 className="text-base font-semibold leading-tight">{t('scheduleTitle')}</h2>
                <p className="text-xs text-muted-foreground">{ac.name}</p>
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold">{s.startTime}</span>
                        <span className="text-muted-foreground">→</span>
                        {s.hvacMode === 'off' ? (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <PowerOff className="size-3.5" />{t('scheduleModeOff')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-sm">
                            <Snowflake className="size-3.5 text-state-cool" />
                            {s.temperature != null ? `${s.temperature}°C` : t(`scheduleMode_${s.hvacMode}` as Parameters<typeof t>[0])}
                          </span>
                        )}
                        {s.fanMode && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Wind className="size-3" />
                            {t(`fan_${s.fanMode}` as Parameters<typeof t>[0], { defaultMessage: s.fanMode })}
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
                <div className="flex gap-1.5">
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

              {/* HVAC Mode selector */}
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">{t('scheduleHvacMode')}</p>
                <div className="flex flex-wrap gap-1">
                  {HVAC_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setNewMode(mode)}
                      className={[
                        'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                        newMode === mode
                          ? mode === 'off'
                            ? 'border-slate-500/60 bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300'
                            : 'border-state-cool/60 bg-state-cool/15 text-state-cool-fg'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent',
                      ].join(' ')}
                    >
                      {mode === 'off' ? <PowerOff className="size-3" /> : <Snowflake className="size-3" />}
                      {t(`scheduleMode_${mode}` as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fan mode selector (hidden when off) */}
              {newMode !== 'off' && (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">{t('fanSpeed')}</p>
                  <div className="flex flex-wrap gap-1">
                    {FAN_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setNewFanMode(mode)}
                        className={[
                          'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
                          newFanMode === mode
                            ? 'border-state-cool/50 bg-state-cool/10 text-state-cool-fg'
                            : 'border-border bg-background text-muted-foreground hover:bg-accent',
                        ].join(' ')}
                      >
                        <Wind className="size-3" />
                        {t(`fan_${mode}` as Parameters<typeof t>[0])}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Time + temp */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="sr-only" htmlFor="ac-slot-time">{t('slotTime')}</label>
                  <input
                    id="ac-slot-time"
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                {newMode !== 'off' && newMode !== 'fan_only' && (
                  <div className="flex-1">
                    <label className="sr-only" htmlFor="ac-slot-temp">{t('slotTemp')}</label>
                    <input
                      id="ac-slot-temp"
                      type="number"
                      step="1"
                      min="10"
                      max="35"
                      placeholder={t('slotTempPlaceholder')}
                      value={newTemp}
                      onChange={(e) => setNewTemp(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleAdd}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                </button>
              </div>
              {formError && <p className="text-xs text-destructive">{formError}</p>}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-5 py-3 shrink-0">
            <p className="text-xs text-muted-foreground">
              {ac.haEntityId ? t('scheduleHaInfo') : t('scheduleNoHaWarning')}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
