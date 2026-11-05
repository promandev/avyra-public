'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Cat,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Timer,
  Trash2,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';

import {
  availabilityEntity,
  clampToSetting,
  humanizeValue,
  type LitterCatInfo,
  type LitterCommand,
  type LitterDayData,
  type LitterLiveState,
} from '@/lib/litter';
import { DevicePushToggle } from '../_components/device-push-toggle';
import { deleteLitterBox, runLitterCommand, setLitterAutoClean, setLitterCleanDelay } from './actions';
import { LitterDay } from './litter-day';
import { LitterFormDialog, type EditableLitterData } from './litter-form-dialog';

export type LitterUnit = EditableLitterData;

/** Cada cuánto se relee el estado y el día de hoy: las visitas entran solas. */
const REFRESH_MS = 30_000;
/** Ventana para confirmar una acción que no tiene vuelta atrás. */
const CONFIRM_MS = 4_000;
/** Tiempo máximo que se mantiene un valor optimista sin confirmar por HA. */
const OPTIMISTIC_MS = 10_000;
/** Pausa tras el último toque antes de mandar el retraso nuevo. */
const DELAY_SEND_MS = 800;

/**
 * Estado del arenero. Sin entidad de estado (el MINI-D no tiene) se enseña sólo
 * si está conectado, que se sabe por cualquiera de sus sensores.
 */
function StatusChip({
  live,
  hasStatus,
  hasAvailability,
}: {
  live: LitterLiveState | undefined;
  hasStatus: boolean;
  hasAvailability: boolean;
}) {
  const t = useTranslations('litter');
  if (!hasAvailability) {
    return (
      <span className="rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium leading-none text-muted-foreground">
        {t('noStatusEntity')}
      </span>
    );
  }
  const offline = !live || live.offline;
  const state = live?.state ?? null;
  let label: string;
  if (offline) label = t('offline');
  else if (!hasStatus) label = t('online');
  else label = state === null || state === 'unknown' ? t('statusUnknown') : humanizeValue(state);
  return (
    <span
      className={[
        'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium leading-none',
        offline ? 'bg-destructive/15 text-destructive' : 'bg-muted/60 text-muted-foreground',
      ].join(' ')}
    >
      {offline ? <WifiOff className="size-3" /> : !hasStatus && <Wifi className="size-3" />}
      {label}
    </span>
  );
}

/**
 * Limpieza automática: interruptor y cuánto espera tras salir el gato. El
 * retraso se manda cuando dejas de pulsar, no en cada toque: así se pasa de 3
 * a 10 sin mandar siete órdenes seguidas al arenero.
 */
function AutoCleanControl({
  deviceId,
  live,
  hasToggle,
  hasDelay,
  disabled,
  onError,
}: {
  deviceId: string;
  live: LitterLiveState | undefined;
  hasToggle: boolean;
  hasDelay: boolean;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const t = useTranslations('litter');
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sending, setSending] = useState<'toggle' | 'delay' | null>(null);

  // Valores optimistas: se descartan cuando HA informa de otro valor o al
  // caducar, para que un arenero que ignora la orden no lo aparente.
  const actualOn = live?.autoClean ?? null;
  const [pendingOn, setPendingOn] = useState<boolean | null>(null);
  const [seenOn, setSeenOn] = useState(actualOn);
  if (seenOn !== actualOn) {
    setSeenOn(actualOn);
    setPendingOn(null);
  }

  const setting = live?.cleanDelay ?? null;
  const actualDelay = setting?.value ?? null;
  const [draft, setDraft] = useState<number | null>(null);
  const [seenDelay, setSeenDelay] = useState(actualDelay);
  if (seenDelay !== actualDelay) {
    setSeenDelay(actualDelay);
    setDraft(null);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const on = pendingOn ?? actualOn;
  const delay = draft ?? actualDelay;

  function toggle() {
    if (on === null) return;
    const next = !on;
    setPendingOn(next);
    setSending('toggle');
    void setLitterAutoClean(deviceId, next).then((result) => {
      if (result.error) onError(result.error);
      setSending(null);
      setTimeout(() => setPendingOn((p) => (p === next ? null : p)), result.error ? 0 : OPTIMISTIC_MS);
      router.refresh();
    });
  }

  function nudge(direction: 1 | -1) {
    if (!setting || delay === null) return;
    const next = clampToSetting(delay + direction * setting.step, setting);
    if (next === delay) return;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSending('delay');
      void setLitterCleanDelay(deviceId, next).then((result) => {
        if (result.error) onError(result.error);
        setSending(null);
        setTimeout(() => setDraft((d) => (d === next ? null : d)), result.error ? 0 : OPTIMISTIC_MS);
        router.refresh();
      });
    }, DELAY_SEND_MS);
  }

  const stepButton = (direction: 1 | -1, Icon: typeof Minus, label: string, atLimit: boolean) => (
    <button
      type="button"
      onClick={() => nudge(direction)}
      disabled={disabled || !setting || atLimit}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-lg border border-border bg-background transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="size-3.5" />
    </button>
  );

  return (
    <div className="space-y-2.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
      {hasToggle && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Timer className="size-4 text-muted-foreground" />
            {t('autoClean')}
          </span>
          <span className="flex items-center gap-2">
            {sending === 'toggle' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            <button
              type="button"
              role="switch"
              aria-checked={on === true}
              aria-label={t('autoClean')}
              onClick={toggle}
              disabled={disabled || on === null || sending === 'toggle'}
              className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                on ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full bg-background shadow transition-all ${
                  on ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </button>
          </span>
        </div>
      )}

      {hasDelay && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{t('cleanDelayLabel')}</span>
          <span className="flex items-center gap-1.5">
            {sending === 'delay' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            {stepButton(-1, Minus, t('delayLess'), !setting || delay === null || delay <= setting.min)}
            <span className="w-14 text-center text-sm font-semibold tnum">
              {delay === null ? '—' : t('delayValue', { count: delay })}
            </span>
            {stepButton(1, Plus, t('delayMore'), !setting || delay === null || delay >= setting.max)}
          </span>
        </div>
      )}

      {hasDelay && on === false && <p className="text-[11px] text-muted-foreground">{t('delayInactive')}</p>}
    </div>
  );
}

function LitterCard({
  unit,
  live,
  cats,
  today,
  initialDay,
  canManage,
  pushOn,
  onEdit,
}: {
  unit: LitterUnit;
  live: LitterLiveState | undefined;
  cats: LitterCatInfo[];
  today: string;
  initialDay: LitterDayData;
  canManage: boolean;
  pushOn: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('litter');
  const tc = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<LitterCommand | null>(null);
  const [confirming, setConfirming] = useState<LitterCommand | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  const offline = live?.offline ?? false;

  function send(command: LitterCommand) {
    setNotice(null);
    setBusy(command);
    startTransition(async () => {
      const result = await runLitterCommand(unit.id, command);
      setNotice(result.error ? { ok: false, text: result.error } : { ok: true, text: t('sent') });
      setBusy(null);
      router.refresh();
    });
  }

  /** Vaciar tira toda la arena y reiniciar corta lo que esté haciendo: piden un segundo toque. */
  function press(command: LitterCommand, needsConfirm: boolean) {
    if (!needsConfirm || confirming === command) {
      setConfirming(null);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      send(command);
      return;
    }
    setConfirming(command);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirming(null), CONFIRM_MS);
  }

  const actions: { command: LitterCommand; entity: string | null; label: string; confirm: string; Icon: typeof Cat; needsConfirm: boolean }[] = [
    { command: 'clean', entity: unit.cleanEntityId, label: t('clean'), confirm: '', Icon: Sparkles, needsConfirm: false },
    { command: 'empty', entity: unit.emptyEntityId, label: t('empty'), confirm: t('confirmEmpty'), Icon: Trash2, needsConfirm: true },
    { command: 'reset', entity: unit.resetEntityId, label: t('reset'), confirm: t('confirmReset'), Icon: RotateCcw, needsConfirm: true },
  ];
  const available = actions.filter((a) => a.entity);

  return (
    <div className="glass rounded-2xl p-5 transition-all duration-300 hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Cat className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{unit.name}</p>
            {unit.model && <p className="truncate text-sm text-muted-foreground">{unit.model}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <DevicePushToggle deviceId={unit.id} initial={pushOn} />
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
              <form action={deleteLitterBox.bind(null, unit.id)}>
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
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip live={live} hasStatus={!!unit.haEntityId} hasAvailability={!!availabilityEntity(unit)} />
          {live?.faults.map((fault) => (
            <span
              key={fault}
              className="flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-1 text-[11px] font-medium leading-none text-destructive"
            >
              <TriangleAlert className="size-3" />
              {fault}
            </span>
          ))}
        </div>

        {available.length > 0 ? (
          <div className={`grid gap-2 ${available.length === 1 ? 'grid-cols-1' : available.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {available.map(({ command, label, confirm, Icon, needsConfirm }) => {
              const asking = confirming === command;
              const primary = command === 'clean';
              return (
                <button
                  key={command}
                  type="button"
                  disabled={isPending || offline}
                  onClick={() => press(command, needsConfirm)}
                  className={[
                    'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                    asking
                      ? 'border border-destructive/50 bg-destructive/15 text-destructive'
                      : primary
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90'
                        : 'border border-border bg-background hover:bg-accent',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  ].join(' ')}
                >
                  {busy === command ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                  <span className="truncate">{asking ? confirm : label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          canManage && <p className="text-xs text-muted-foreground">{t('noActions')}</p>
        )}

        {(unit.autoCleanEntityId || unit.cleanDelayEntityId) && (
          <AutoCleanControl
            deviceId={unit.id}
            live={live}
            hasToggle={!!unit.autoCleanEntityId}
            hasDelay={!!unit.cleanDelayEntityId}
            disabled={offline}
            onError={(text) => setNotice({ ok: false, text })}
          />
        )}

        {notice && <p className={`text-xs ${notice.ok ? 'text-muted-foreground' : 'text-destructive'}`}>{notice.text}</p>}

        <LitterDay
          deviceId={unit.id}
          cats={cats}
          today={today}
          initial={initialDay}
          poopMinSeconds={unit.poopMinSeconds}
        />
      </div>
    </div>
  );
}

export function LitterGrid({
  units,
  liveStates,
  pushPrefs,
  cats,
  today,
  initialDays,
  canManage,
}: {
  units: LitterUnit[];
  liveStates: Record<string, LitterLiveState>;
  pushPrefs: Record<string, boolean>;
  cats: LitterCatInfo[];
  today: string;
  initialDays: Record<string, LitterDayData>;
  canManage: boolean;
}) {
  const t = useTranslations('litter');
  const router = useRouter();
  const [editing, setEditing] = useState<EditableLitterData | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);

  // Sólo con la pestaña visible: no tiene sentido consultar en segundo plano.
  useEffect(() => {
    if (units.length === 0) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [units.length, router]);

  if (units.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center animate-scale-in">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Cat className="size-7 text-primary/60" />
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
      <div className="grid gap-4 xl:grid-cols-2 stagger">
        {units.map((unit) => (
          <LitterCard
            key={unit.id}
            unit={unit}
            live={liveStates[unit.id]}
            cats={cats}
            today={today}
            initialDay={initialDays[unit.id]!}
            canManage={canManage}
            pushOn={pushPrefs[unit.id] ?? true}
            onEdit={() => setEditing(unit)}
          />
        ))}
      </div>
      {editing && <LitterFormDialog unit={editing} onClose={closeEdit} />}
    </>
  );
}
