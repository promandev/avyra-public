'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Calendar,
  Droplet,
  House,
  Leaf,
  Loader2,
  MapPin,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Square,
  Trash2,
  Wind,
} from 'lucide-react';

import { VacuumIcon } from '@/components/vacuum-icon';
import {
  humanizeValue,
  pickEcoFanSpeed,
  pickStandardFanSpeed,
  type VacuumDirection,
  type VacuumLiveState,
  type WaterTankReading,
} from '@/lib/vacuum';
import {
  deleteVacuum,
  driveVacuum,
  runVacuumCommand,
  setVacuumFanSpeed,
  startVacuumInMode,
  type VacuumActionResult,
} from './actions';
import { VacuumFormDialog, type EditableVacuumData } from './vacuum-form-dialog';
import { VacuumScheduleModal } from './schedule-modal';
import { DevicePushToggle } from '../_components/device-push-toggle';
import { VacuumActivity } from './vacuum-activity';

export type VacuumUnit = EditableVacuumData;

/** Cada cuánto se relee el estado: batería y "volviendo a casa" cambian solos. */
const REFRESH_MS = 15_000;
/** Tiempo máximo que se mantiene un estado optimista sin confirmar por HA. */
const OPTIMISTIC_MS = 10_000;

const KNOWN_STATES = ['cleaning', 'docked', 'returning', 'paused', 'idle', 'error', 'unavailable', 'unknown'];

function StatusChip({ state }: { state: string }) {
  const t = useTranslations('vacuum');
  const label = KNOWN_STATES.includes(state)
    ? t(`status_${state}` as Parameters<typeof t>[0])
    : humanizeValue(state);
  const tone =
    state === 'cleaning'
      ? 'bg-primary/20 text-primary'
      : state === 'returning'
        ? 'bg-state-cool/20 text-state-cool-fg'
        : state === 'error'
          ? 'bg-destructive/15 text-destructive'
          : 'bg-muted/60 text-muted-foreground';
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium leading-none ${tone}`}>
      {label}
    </span>
  );
}

function BatteryBadge({ level }: { level: number }) {
  const t = useTranslations('vacuum');
  const Icon = level <= 20 ? BatteryLow : level <= 60 ? BatteryMedium : BatteryFull;
  return (
    <span
      className={`flex items-center gap-1 text-xs tnum ${level <= 20 ? 'text-destructive' : 'text-muted-foreground'}`}
      title={t('battery')}
    >
      <Icon className="size-4" />
      {level}%
    </span>
  );
}

function WaterTank({ reading }: { reading: WaterTankReading }) {
  const t = useTranslations('vacuum');
  const pct = reading.fraction === null ? null : Math.round(reading.fraction * 100);

  let text: string;
  if (reading.unavailable) text = t('status_unavailable');
  else if (reading.installed !== null) text = reading.installed ? t('waterTankInstalled') : t('waterTankMissing');
  else if (Number.isFinite(Number(reading.label)) && pct !== null) text = `${pct}%`;
  else text = humanizeValue(reading.label);

  const empty = !reading.unavailable && (reading.installed === false || pct === 0);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      {/* Depósito dibujado: se llena según el nivel que llega de HA. */}
      <div
        className="relative h-9 w-6 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40"
        aria-hidden="true"
      >
        {pct !== null && (
          <div
            className="absolute inset-x-0 bottom-0 bg-state-cool/60 transition-all duration-500"
            style={{ height: `${pct}%` }}
          />
        )}
      </div>
      <div className="min-w-0 text-xs">
        <p className="flex items-center gap-1 text-muted-foreground">
          <Droplet className="size-3" />
          {t('waterTank')}
        </p>
        <p className={`text-sm font-semibold ${empty ? 'text-destructive' : ''}`}>{text}</p>
      </div>
    </div>
  );
}

/**
 * Cruceta de control manual. Mantener pulsado mueve; soltar manda `stop`.
 * Las server actions de un mismo cliente se encolan en orden, así que el
 * `stop` siempre llega después de la dirección aunque se suelte enseguida.
 */
function DrivePad({
  deviceId,
  disabled,
  onError,
}: {
  deviceId: string;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const t = useTranslations('vacuum');
  const [active, setActive] = useState<VacuumDirection | null>(null);
  const activeRef = useRef<VacuumDirection | null>(null);

  const send = useCallback(
    async (direction: VacuumDirection) => {
      const result = await driveVacuum(deviceId, direction);
      if (result.error) onError(result.error);
    },
    [deviceId, onError],
  );

  // Si se sale de la página con una flecha pulsada, el robot no debe seguir.
  useEffect(
    () => () => {
      if (activeRef.current) void driveVacuum(deviceId, 'stop');
    },
    [deviceId],
  );

  function press(direction: VacuumDirection) {
    if (disabled || activeRef.current) return;
    activeRef.current = direction;
    setActive(direction);
    void send(direction);
  }

  function release() {
    if (!activeRef.current) return;
    activeRef.current = null;
    setActive(null);
    void send('stop');
  }

  function arrow(direction: Exclude<VacuumDirection, 'stop'>, Icon: typeof ArrowUp, area: string) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={t(direction)}
        title={t(direction)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          press(direction);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            press(direction);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') release();
        }}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
        className={[
          area,
          'flex size-12 touch-none select-none items-center justify-center rounded-xl border transition',
          active === direction
            ? 'border-primary/60 bg-primary/20 text-primary scale-95'
            : 'border-border bg-background text-foreground hover:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-40',
        ].join(' ')}
      >
        <Icon className="size-5" />
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{t('manualControl')}</p>
      <div className="grid grid-cols-[repeat(3,3rem)] grid-rows-[repeat(3,3rem)] justify-center gap-1.5">
        {arrow('forward', ArrowUp, 'col-start-2 row-start-1')}
        {arrow('left', ArrowLeft, 'col-start-1 row-start-2')}
        <button
          type="button"
          disabled={disabled}
          aria-label={t('stop')}
          title={t('stop')}
          onClick={() => void send('stop')}
          className="col-start-2 row-start-2 flex size-12 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Square className="size-4" />
        </button>
        {arrow('right', ArrowRight, 'col-start-3 row-start-2')}
        {arrow('reverse', ArrowDown, 'col-start-2 row-start-3')}
      </div>
      <p className="text-center text-[11px] text-muted-foreground/80">{t('holdHint')}</p>
    </div>
  );
}

function VacuumCard({
  vacuum,
  live,
  canManage,
  onEdit,
  onSchedule,
  pushOn,
}: {
  vacuum: VacuumUnit;
  live: VacuumLiveState | undefined;
  canManage: boolean;
  onEdit: () => void;
  onSchedule: () => void;
  pushOn: boolean;
}) {
  const t = useTranslations('vacuum');
  const tc = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado optimista: se descarta cuando HA reporta otro estado o al caducar,
  // para que un robot que ignora la orden no se quede "limpiando" en pantalla.
  const actualState = live?.state ?? (vacuum.haEntityId ? 'unavailable' : 'unknown');
  const [pendingState, setPendingState] = useState<string | null>(null);
  useEffect(() => setPendingState(null), [actualState]);
  useEffect(() => {
    if (pendingState === null) return;
    const timer = setTimeout(() => setPendingState(null), OPTIMISTIC_MS);
    return () => clearTimeout(timer);
  }, [pendingState]);

  const actualFan = live?.fanSpeed ?? null;
  const [pendingFan, setPendingFan] = useState<string | null>(null);
  useEffect(() => setPendingFan(null), [actualFan]);

  const state = pendingState ?? actualState;
  const fanSpeed = pendingFan ?? actualFan;
  const fanSpeedList = live?.fanSpeedList ?? [];
  const ecoSpeed = pickEcoFanSpeed(fanSpeedList);
  const standardSpeed = pickStandardFanSpeed(fanSpeedList);

  const hasEntity = !!vacuum.haEntityId;
  const unavailable = !hasEntity || state === 'unavailable' || state === 'unknown';
  const cleaning = state === 'cleaning';
  const controlsDisabled = unavailable || isPending;

  function run(
    key: string,
    action: () => Promise<VacuumActionResult>,
    optimistic: { state?: string; fan?: string | null } = {},
  ) {
    if (controlsDisabled) return;
    setError(null);
    setBusyKey(key);
    if (optimistic.state) setPendingState(optimistic.state);
    if (optimistic.fan) setPendingFan(optimistic.fan);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        setPendingState(null);
        setPendingFan(null);
      }
      setBusyKey(null);
      router.refresh();
    });
  }

  const spinner = (key: string) => (busyKey === key ? <Loader2 className="size-4 animate-spin" /> : null);

  const modeButton = (
    key: 'auto' | 'eco',
    label: string,
    Icon: typeof Leaf,
    speed: string | null,
  ) => {
    const selected = !!speed && fanSpeed === speed;
    return (
      <button
        type="button"
        disabled={controlsDisabled}
        onClick={() => run(key, () => startVacuumInMode(vacuum.id, key), { state: 'cleaning', fan: speed })}
        className={[
          'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
          selected
            ? 'border-primary/50 bg-primary/15 text-primary'
            : 'border-border bg-background hover:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
        ].join(' ')}
      >
        {spinner(key) ?? <Icon className="size-4" />}
        {label}
      </button>
    );
  };

  return (
    <div
      className={[
        'rounded-2xl p-5 transition-all duration-300',
        cleaning
          ? 'border border-primary/45 bg-primary/[0.08] shadow-[0_0_44px_-10px_hsl(var(--primary)/0.5)]'
          : 'glass hover:border-primary/30',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={[
            'flex size-11 items-center justify-center rounded-xl',
            cleaning
              ? 'bg-primary/20 text-primary shadow-[0_0_22px_-4px_hsl(var(--primary)/0.6)]'
              : 'bg-primary/15 text-primary',
            !hasEntity ? 'opacity-40' : '',
          ].join(' ')}
        >
          <VacuumIcon className={`size-5 ${cleaning ? 'animate-spin [animation-duration:3s]' : ''}`} />
        </div>

        <div className="flex items-center gap-1">
          <DevicePushToggle deviceId={vacuum.id} initial={pushOn} />
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
              <form action={deleteVacuum.bind(null, vacuum.id)}>
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

      <div className="mt-3 space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{vacuum.name}</p>
            {vacuum.model && <p className="text-sm text-muted-foreground">{vacuum.model}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {hasEntity ? <StatusChip state={state} /> : (
              <span className="rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium leading-none text-muted-foreground">
                {t('noHaEntity')}
              </span>
            )}
            {live?.battery != null && <BatteryBadge level={live.battery} />}
          </div>
        </div>

        {/* Arranque / pausa: la acción principal, a todo el ancho. */}
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={() =>
            cleaning
              ? run('toggle', () => runVacuumCommand(vacuum.id, 'pause'), { state: 'paused' })
              : run('toggle', () => runVacuumCommand(vacuum.id, 'start'), { state: 'cleaning' })
          }
          className={[
            'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition',
            cleaning
              ? 'border border-primary/40 bg-background text-primary hover:bg-primary/10'
              : 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90',
            'disabled:cursor-not-allowed disabled:opacity-50',
          ].join(' ')}
        >
          {spinner('toggle') ?? (cleaning ? <Pause className="size-4" /> : <Play className="size-4" />)}
          {cleaning ? t('pause') : t('start')}
        </button>

        <div className="grid grid-cols-2 gap-2">
          {modeButton('auto', t('modeAuto'), Sparkles, standardSpeed)}
          {modeButton('eco', t('modeEco'), Leaf, ecoSpeed)}
          <button
            type="button"
            disabled={controlsDisabled || state === 'docked'}
            onClick={() => run('home', () => runVacuumCommand(vacuum.id, 'return_to_base'), { state: 'returning' })}
            className={[
              'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
              state === 'returning'
                ? 'border-state-cool/50 bg-state-cool/15 text-state-cool-fg'
                : 'border-border bg-background hover:bg-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          >
            {spinner('home') ?? <House className="size-4" />}
            {t('returnHome')}
          </button>
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={() => run('locate', () => runVacuumCommand(vacuum.id, 'locate'))}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {spinner('locate') ?? <MapPin className="size-4" />}
            {t('locate')}
          </button>
        </div>

        {fanSpeedList.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wind className="size-3.5" />
              <span>{t('suction')}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {fanSpeedList.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => run(`fan:${speed}`, () => setVacuumFanSpeed(vacuum.id, speed), { fan: speed })}
                  className={[
                    'rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:opacity-50',
                    fanSpeed === speed
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent',
                  ].join(' ')}
                >
                  {humanizeValue(speed)}
                </button>
              ))}
            </div>
          </div>
        )}

        {live?.waterTank && <WaterTank reading={live.waterTank} />}

        <DrivePad deviceId={vacuum.id} disabled={unavailable} onError={setError} />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <VacuumActivity deviceId={vacuum.id} />
      </div>
    </div>
  );
}

export function VacuumGrid({
  vacuums,
  liveStates,
  pushPrefs,
  canManage,
}: {
  vacuums: VacuumUnit[];
  liveStates: Record<string, VacuumLiveState>;
  pushPrefs: Record<string, boolean>;
  canManage: boolean;
}) {
  const t = useTranslations('vacuum');
  const router = useRouter();
  const [editing, setEditing] = useState<EditableVacuumData | null>(null);
  const [scheduleFor, setScheduleFor] = useState<VacuumUnit | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);
  const closeSchedule = useCallback(() => setScheduleFor(null), []);

  // Sólo con la pestaña visible: no tiene sentido consultar HA en segundo plano.
  const hasEntities = vacuums.some((v) => v.haEntityId);
  useEffect(() => {
    if (!hasEntities) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasEntities, router]);

  if (vacuums.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center animate-scale-in">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
          <VacuumIcon className="size-7 text-primary/60" />
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
        {vacuums.map((vacuum) => (
          <VacuumCard
            key={vacuum.id}
            vacuum={vacuum}
            live={liveStates[vacuum.id]}
            canManage={canManage}
            onEdit={() => setEditing(vacuum)}
            onSchedule={() => setScheduleFor(vacuum)}
            pushOn={pushPrefs[vacuum.id] ?? true}
          />
        ))}
      </div>
      {editing && <VacuumFormDialog vacuum={editing} onClose={closeEdit} />}
      {scheduleFor && <VacuumScheduleModal vacuum={scheduleFor} onClose={closeSchedule} />}
    </>
  );
}
