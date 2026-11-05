'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { Trash2, Pencil, Flame, Loader2, Calendar, TriangleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { THERMOSTAT_STALE_AFTER_MS } from '@/lib/thermostat-health';
import { deleteThermostat, setThermostatPower, setThermostatTargetTemperature } from './actions';
import { EditThermostatDialog, type EditableThermostatData } from './edit-thermostat-dialog';
import { ScheduleModal } from './schedule-modal';
import { DevicePushToggle } from '../_components/device-push-toggle';

interface Thermostat {
  id: string;
  name: string;
  model: string | null;
  haEntityId: string | null;
  temperatureScale: number;
}

interface ClimateState {
  state: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  reportedAt: string | null;
}

type ClimateStates = Record<string, ClimateState>;

function ThermostatCard({
  therm,
  climate,
  now,
  onEdit,
  onSchedule,
  pushOn,
  canManage,
}: {
  therm: Thermostat;
  climate: ClimateState | undefined;
  now: number;
  onEdit: () => void;
  onSchedule: () => void;
  pushOn: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('heating');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const scale = therm.temperatureScale ?? 1;

  // Toggle state: keep pending value until HA confirms via RSC refresh.
  // (useOptimistic reverts when isPending clears, before router.refresh() completes — same
  //  problem as temperature; so we use the same pendingXxx pattern instead.)
  const actualState = climate?.state ?? 'unknown';
  const [pendingToggleState, setPendingToggleState] = useState<string | null>(null);
  // Se compara encendido/apagado, no el modo: lo pendiente es 'heat' pero el
  // aparato puede volver como 'heat_cool', y con la comparación exacta lo
  // pendiente no se soltaba nunca y tapaba un apagado posterior.
  useEffect(() => {
    if (climate?.state != null) {
      const reportedOff = climate.state === 'off';
      setPendingToggleState((prev) => (prev === null || (prev === 'off') === reportedOff ? null : prev));
    }
  }, [climate?.state]);
  const resolvedState = pendingToggleState ?? actualState;

  const [error, setError] = useState<string | null>(null);

  // Target temperature: keep last-sent value visible until HA confirms via refresh.
  const scaledTarget = climate?.targetTemperature != null ? climate.targetTemperature * scale : null;
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  // Only clear pendingTarget once HA's reported value matches what we set (within 0.1°).
  // Using functional update so we can compare without adding pendingTarget to deps.
  useEffect(() => {
    if (scaledTarget !== null) {
      setPendingTarget((prev) => {
        if (prev === null) return null;
        return Math.abs(scaledTarget - prev) < 0.1 ? null : prev;
      });
    }
  }, [scaledTarget]);

  // Toggle: keep spinner until the server action + router.refresh() round-trip completes.
  // Clearing on climate?.state is unreliable: if HA hasn't updated by the time refresh
  // arrives, the value doesn't change and the effect never fires → infinite spinner.
  // Clearing on isPending → false is safe: the transition ends when the action returns
  // and router.refresh() has been fired, which is the right moment to drop the spinner.
  const [syncingToggle, setSyncingToggle] = useState(false);
  useEffect(() => { if (!isPending) setSyncingToggle(false); }, [isPending]);

  const isBusy = isPending || syncingToggle;
  const isAdjustBusy = isPending;

  const hasEntity = !!therm.haEntityId;
  const isUnavailable = resolvedState === 'unavailable' || resolvedState === 'unknown';
  const isOff = resolvedState === 'off';
  const isOn = hasEntity && !isOff && !isUnavailable;

  const displayCurrentTemp = climate?.currentTemperature ?? null;
  const resolvedDisplayTarget = pendingTarget ?? scaledTarget ?? displayCurrentTemp ?? 20;

  const reportedMs = climate?.reportedAt ? Date.parse(climate.reportedAt) : NaN;
  const isStale = hasEntity && !isUnavailable && Number.isFinite(reportedMs) && now - reportedMs > THERMOSTAT_STALE_AFTER_MS;

  function handleToggle() {
    if (!hasEntity || isBusy) return;
    // Lo que el usuario ve es lo que quiere cambiar: se manda la orden
    // explícita y no "lo contrario de lo que diga HA", que puede estar desfasado.
    const turnOn = isOff;
    setPendingToggleState(turnOn ? 'heat' : 'off'); // show new state immediately
    setSyncingToggle(true);
    setError(null);
    startTransition(async () => {
      const result = await setThermostatPower(therm.id, turnOn);
      if (result.error) {
        setError(result.error);
        setPendingToggleState(null); // revert on error
        setSyncingToggle(false);
      } else {
        router.refresh();
      }
    });
  }

  function handleAdjust(delta: number) {
    if (!hasEntity || isBusy) return;
    // Work in display units; server action handles inverse scale before sending to HA.
    const next = Number((resolvedDisplayTarget + delta).toFixed(1));
    setPendingTarget(next);
    setError(null);
    startTransition(async () => {
      const result = await setThermostatTargetTemperature(therm.id, next);
      if (result.error) {
        setError(result.error);
        setPendingTarget(null); // revert display on error
      } else {
        // Do NOT overwrite pendingTarget with confirmedTarget:
        // HA may not have processed the command yet and would return the stale value.
        // Instead keep pendingTarget = next until scaledTarget syncs via router.refresh().
        router.refresh();
      }
    });
  }

  return (
    <div
      key={therm.id}
      className={[
        'rounded-2xl p-5 transition-all duration-300',
        isOn
          ? 'border border-state-heat/45 bg-state-heat/[0.08] shadow-[0_0_44px_-10px_hsl(var(--state-heat)/0.5)]'
          : 'glass hover:-translate-y-1 hover:shadow-md hover:border-primary/30',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={[
            'flex size-11 items-center justify-center rounded-xl',
            isOn
              ? 'bg-state-heat/20 text-state-heat shadow-[0_0_22px_-4px_hsl(var(--state-heat)/0.6)]'
              : 'bg-primary/15 text-primary',
            !hasEntity ? 'opacity-40' : '',
          ].join(' ')}
        >
          <Flame className={`size-5 ${isOn ? 'animate-glow' : ''}`} />
        </div>

        <div className="flex items-center gap-1">
          <DevicePushToggle deviceId={therm.id} initial={pushOn} />
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
              <form action={deleteThermostat.bind(null, therm.id)}>
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
          <p className="font-medium">{therm.name}</p>
          {therm.model && <p className="text-sm text-muted-foreground">{therm.model}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
            <p className="text-muted-foreground">{t('currentTemp')}</p>
            <p className="tnum text-base font-semibold">
              {displayCurrentTemp != null ? `${displayCurrentTemp.toFixed(1)}°C` : '—'}
            </p>
          </div>
          {/* La consigna se tiñe cuando está calentando: es el número que el
              usuario acaba de tocar y conviene que salte a la vista. */}
          <div
            className={[
              'rounded-lg border px-3 py-2 transition-colors duration-300',
              isOn ? 'border-state-heat/35 bg-state-heat/10' : 'border-border/60 bg-background/60',
            ].join(' ')}
          >
            <p className="text-muted-foreground">{t('targetTemp')}</p>
            <p className={`tnum text-base font-semibold ${isOn ? 'text-state-heat-fg' : ''}`}>
              {Number.isFinite(resolvedDisplayTarget) ? `${resolvedDisplayTarget.toFixed(1)}°C` : '—'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
          <button
            type="button"
            disabled={!hasEntity || isAdjustBusy}
            onClick={() => handleAdjust(-0.5)}
            className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            title={t('decreaseTemp')}
          >
            {isPending ? <Loader2 className="size-3 animate-spin inline" /> : '-0.5°'}
          </button>
          <button
            type="button"
            disabled={!hasEntity || isBusy || isUnavailable}
            onClick={handleToggle}
            className={[
              'justify-self-center rounded-full px-2 py-1 text-center text-[11px] font-semibold leading-tight sm:px-3 sm:text-xs transition-opacity',
              isOn
                ? 'bg-state-heat/20 text-state-heat-fg hover:opacity-80'
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
            onClick={() => handleAdjust(0.5)}
            className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            title={t('increaseTemp')}
          >
            {isPending ? <Loader2 className="size-3 animate-spin inline" /> : '+0.5°'}
          </button>
        </div>

        {isStale && (
          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('staleData', { when: format.relativeTime(reportedMs, now) })}</span>
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function ThermostatGrid({
  thermostats,
  climateStates,
  now,
  pushPrefs,
  canManage,
}: {
  thermostats: Thermostat[];
  climateStates: ClimateStates;
  /** Hora de la lectura en el servidor: misma cuenta al renderizar y al hidratar. */
  now: number;
  pushPrefs: Record<string, boolean>;
  canManage: boolean;
}) {
  const t = useTranslations('heating');
  const [editing, setEditing] = useState<EditableThermostatData | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Thermostat | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);
  const closeSchedule = useCallback(() => setScheduleFor(null), []);

  if (thermostats.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center animate-scale-in">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Flame className="size-7 text-primary/60" />
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
        {thermostats.map((therm) => {
          const climate = therm.haEntityId ? climateStates[therm.haEntityId] : undefined;
          return (
            <ThermostatCard
              key={therm.id}
              therm={therm}
              climate={climate}
              now={now}
              onEdit={() => setEditing(therm)}
              onSchedule={() => setScheduleFor(therm)}
              pushOn={pushPrefs[therm.id] ?? true}
              canManage={canManage}
            />
          );
        })}
      </div>
      {editing && <EditThermostatDialog thermostat={editing} onClose={closeEdit} />}
      {scheduleFor && <ScheduleModal thermostat={scheduleFor} onClose={closeSchedule} />}
    </>
  );
}
