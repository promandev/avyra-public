'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { Trash2, Pencil, Snowflake, Loader2, Calendar, Wind } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { deleteAc, setAcTargetTemperature, setAcFanMode, toggleAc } from './actions';
import { EditAcDialog, type EditableAcData } from './edit-ac-dialog';
import { AcScheduleModal } from './schedule-modal';
import { DevicePushToggle } from '../_components/device-push-toggle';

interface AcUnit {
  id: string;
  name: string;
  model: string | null;
  haEntityId: string | null;
}

interface AcClimateState {
  state: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  fanMode: string | null;
  fanModes: string[];
}

type AcClimateStates = Record<string, AcClimateState>;

const FAN_MODE_ICONS: Record<string, string> = {
  quiet: '🤫',
  low: '🌀',
  medium_low: '🌀',
  medium: '💨',
  medium_high: '🌬️',
  high: '🌪️',
  auto: '🔄',
};

function AcCard({
  ac,
  climate,
  onEdit,
  onSchedule,
  pushOn,
  canManage,
}: {
  ac: AcUnit;
  climate: AcClimateState | undefined;
  onEdit: () => void;
  onSchedule: () => void;
  pushOn: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('ac');
  const tc = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const actualState = climate?.state ?? 'unknown';
  const [pendingToggleState, setPendingToggleState] = useState<string | null>(null);
  useEffect(() => {
    if (climate?.state != null) {
      setPendingToggleState((prev) => (prev === null || prev === climate.state ? null : prev));
    }
  }, [climate?.state]);
  const resolvedState = pendingToggleState ?? actualState;

  const [error, setError] = useState<string | null>(null);

  // Target temperature
  const scaledTarget = climate?.targetTemperature ?? null;
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  useEffect(() => {
    if (scaledTarget !== null) {
      setPendingTarget((prev) => {
        if (prev === null) return null;
        return Math.abs(scaledTarget - prev) < 0.1 ? null : prev;
      });
    }
  }, [scaledTarget]);

  // Fan mode
  const actualFanMode = climate?.fanMode ?? null;
  const [pendingFanMode, setPendingFanMode] = useState<string | null>(null);
  useEffect(() => {
    if (actualFanMode != null) {
      setPendingFanMode((prev) => (prev === null || prev === actualFanMode ? null : prev));
    }
  }, [actualFanMode]);
  const resolvedFanMode = pendingFanMode ?? actualFanMode;

  // Toggle sync
  const [syncingToggle, setSyncingToggle] = useState(false);
  useEffect(() => { if (!isPending) setSyncingToggle(false); }, [isPending]);

  const isBusy = isPending || syncingToggle;
  const isAdjustBusy = isPending;

  const hasEntity = !!ac.haEntityId;
  const isUnavailable = resolvedState === 'unavailable' || resolvedState === 'unknown';
  const isOff = resolvedState === 'off';
  const isOn = hasEntity && !isOff && !isUnavailable;

  const displayCurrentTemp = climate?.currentTemperature ?? null;
  const resolvedDisplayTarget = pendingTarget ?? scaledTarget ?? 24;

  function handleToggle() {
    if (!hasEntity || isBusy) return;
    const next = isOff ? 'cool' : 'off';
    setPendingToggleState(next);
    setSyncingToggle(true);
    setError(null);
    startTransition(async () => {
      const result = await toggleAc(ac.id);
      if (result.error) {
        setError(result.error);
        setPendingToggleState(null);
        setSyncingToggle(false);
      } else {
        router.refresh();
      }
    });
  }

  function handleAdjust(delta: number) {
    if (!hasEntity || isBusy) return;
    const next = Number((resolvedDisplayTarget + delta).toFixed(1));
    if (next < 10 || next > 35) return;
    setPendingTarget(next);
    setError(null);
    startTransition(async () => {
      const result = await setAcTargetTemperature(ac.id, next);
      if (result.error) {
        setError(result.error);
        setPendingTarget(null);
      } else {
        router.refresh();
      }
    });
  }

  function handleFanMode(mode: string) {
    if (!hasEntity || isBusy) return;
    setPendingFanMode(mode);
    setError(null);
    startTransition(async () => {
      const result = await setAcFanMode(ac.id, mode);
      if (result.error) {
        setError(result.error);
        setPendingFanMode(null);
      } else {
        router.refresh();
      }
    });
  }

  const fanModes = climate?.fanModes ?? [];

  return (
    <div
      className={[
        'rounded-2xl p-5 transition-all duration-300',
        isOn
          ? 'border border-state-cool/45 bg-state-cool/[0.08] shadow-[0_0_44px_-10px_hsl(var(--state-cool)/0.5)]'
          : 'glass hover:-translate-y-1 hover:shadow-md hover:border-primary/30',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={[
            'flex size-11 items-center justify-center rounded-xl',
            isOn
              ? 'bg-state-cool/20 text-state-cool shadow-[0_0_22px_-4px_hsl(var(--state-cool)/0.6)]'
              : 'bg-primary/15 text-primary',
            !hasEntity ? 'opacity-40' : '',
          ].join(' ')}
        >
          <Snowflake className={`size-5 ${isOn ? 'animate-glow' : ''}`} />
        </div>

        <div className="flex items-center gap-1">
          <DevicePushToggle deviceId={ac.id} initial={pushOn} />
          <button
            type="button"
            onClick={onSchedule}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
            title={t('scheduleBtn')}
          >
            <Calendar className="size-4" />
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
                title={tc('edit')}
              >
                <Pencil className="size-4" />
              </button>
              <form action={deleteAc.bind(null, ac.id)}>
                <button
                  type="submit"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                  title={tc('delete')}
                >
                  <Trash2 className="size-4" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <p className="font-medium">{ac.name}</p>
          {ac.model && <p className="text-sm text-muted-foreground">{ac.model}</p>}
        </div>

        {/* Temperature display */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
            <p className="text-muted-foreground">{t('currentTemp')}</p>
            <p className="tnum text-base font-semibold">
              {displayCurrentTemp != null ? `${displayCurrentTemp.toFixed(1)}°C` : '—'}
            </p>
          </div>
          {/* La consigna se tiñe mientras enfría, igual que en calefacción. */}
          <div
            className={[
              'rounded-lg border px-3 py-2 transition-colors duration-300',
              isOn ? 'border-state-cool/35 bg-state-cool/10' : 'border-border/60 bg-background/60',
            ].join(' ')}
          >
            <p className="text-muted-foreground">{t('targetTemp')}</p>
            <p className={`tnum text-base font-semibold ${isOn ? 'text-state-cool-fg' : ''}`}>
              {Number.isFinite(resolvedDisplayTarget) ? `${resolvedDisplayTarget.toFixed(1)}°C` : '—'}
            </p>
          </div>
        </div>

        {/* Temperature controls */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
          <button
            type="button"
            disabled={!hasEntity || isAdjustBusy}
            onClick={() => handleAdjust(-1)}
            className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            title={t('decreaseTemp')}
          >
            {isPending ? <Loader2 className="size-3 animate-spin inline" /> : '-1°'}
          </button>
          <button
            type="button"
            disabled={!hasEntity || isBusy || isUnavailable}
            onClick={handleToggle}
            className={[
              'justify-self-center rounded-full px-2 py-1 text-center text-[11px] font-semibold leading-tight sm:px-3 sm:text-xs transition-opacity',
              isOn
                ? 'bg-state-cool/20 text-state-cool-fg hover:opacity-80'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              (!hasEntity || isUnavailable) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            {syncingToggle ? <Loader2 className="size-3 animate-spin inline mr-1" /> : null}
            {!hasEntity ? t('noHaEntity') : isUnavailable ? t('unavailable') : isOn ? t('turnOff') : t('turnOn')}
          </button>
          <button
            type="button"
            disabled={!hasEntity || isAdjustBusy}
            onClick={() => handleAdjust(1)}
            className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            title={t('increaseTemp')}
          >
            {isPending ? <Loader2 className="size-3 animate-spin inline" /> : '+1°'}
          </button>
        </div>

        {/* Fan speed control */}
        {hasEntity && fanModes.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wind className="size-3.5" />
              <span>{t('fanSpeed')}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {fanModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleFanMode(mode)}
                  className={[
                    'rounded-md px-2 py-1 text-[11px] font-medium transition',
                    resolvedFanMode === mode
                      ? 'border border-state-cool/40 bg-state-cool/20 text-state-cool-fg'
                      : 'border border-border bg-background text-muted-foreground hover:bg-accent',
                  ].join(' ')}
                >
                  {FAN_MODE_ICONS[mode] ?? '💨'} {t(`fan_${mode}` as Parameters<typeof t>[0], { defaultMessage: mode })}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function AcGrid({
  acUnits,
  climateStates,
  pushPrefs,
  canManage,
}: {
  acUnits: AcUnit[];
  climateStates: AcClimateStates;
  pushPrefs: Record<string, boolean>;
  canManage: boolean;
}) {
  const t = useTranslations('ac');
  const [editing, setEditing] = useState<EditableAcData | null>(null);
  const [scheduleFor, setScheduleFor] = useState<AcUnit | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);
  const closeSchedule = useCallback(() => setScheduleFor(null), []);

  if (acUnits.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center animate-scale-in">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Snowflake className="size-7 text-primary/60" />
        </div>
        <p className="text-muted-foreground">
          {t('noDevices')}
          <br />
          <span className="text-sm">{t('addHint')}</span>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 stagger">
        {acUnits.map((ac) => {
          const climate = ac.haEntityId ? climateStates[ac.haEntityId] : undefined;
          return (
            <AcCard
              key={ac.id}
              ac={ac}
              climate={climate}
              onEdit={() => setEditing(ac)}
              onSchedule={() => setScheduleFor(ac)}
              pushOn={pushPrefs[ac.id] ?? true}
              canManage={canManage}
            />
          );
        })}
      </div>
      {editing && <EditAcDialog ac={editing} onClose={closeEdit} />}
      {scheduleFor && <AcScheduleModal ac={scheduleFor} onClose={closeSchedule} />}
    </>
  );
}
