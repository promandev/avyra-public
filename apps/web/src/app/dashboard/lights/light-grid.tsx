'use client';

import { useState, useCallback, useOptimistic, useTransition } from 'react';
import { Trash2, Pencil, Lightbulb, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { deleteLight, toggleLight } from './actions';
import { EditLightDialog, type EditableLightData } from './edit-light-dialog';
import type { HaState } from '@/lib/ha';
import { DevicePushToggle } from '../_components/device-push-toggle';

interface Light {
  id: string;
  name: string;
  model: string | null;
  haEntityId: string | null;
}

type HaStates = Record<string, HaState>;

function LightCard({
  light,
  initialState,
  onEdit,
  pushOn,
  canManage,
}: {
  light: Light;
  initialState: HaState | undefined;
  onEdit: () => void;
  pushOn: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('lights');
  const tc = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useOptimistic(initialState);
  const [error, setError] = useState<string | null>(null);

  const isOn = optimisticState === 'on';
  const isUnavailable = optimisticState === 'unavailable';
  const canControl = !!light.haEntityId;

  function handleToggle() {
    if (!canControl || isPending) return;
    const next: HaState = isOn ? 'off' : 'on';
    setError(null);
    startTransition(async () => {
      setOptimisticState(next);
      const result = await toggleLight(light.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div
      role={canControl ? 'button' : undefined}
      tabIndex={canControl ? 0 : undefined}
      aria-pressed={canControl ? isOn : undefined}
      onKeyDown={
        canControl
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggle();
              }
            }
          : undefined
      }
      onClick={handleToggle}
      className={[
        'group relative rounded-2xl p-5 transition-all duration-500 select-none',
        isOn
          ? 'border border-state-light/45 bg-state-light/[0.07] shadow-[0_0_44px_-10px_hsl(var(--state-light)/0.5)] hover:shadow-[0_0_60px_-10px_hsl(var(--state-light)/0.65)]'
          : 'glass hover:-translate-y-1 hover:shadow-md hover:border-primary/30',
        canControl ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default',
      ].join(' ')}
    >
      <div
        className="absolute right-3 top-3 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <DevicePushToggle deviceId={light.id} initial={pushOn} />
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
            <form action={deleteLight.bind(null, light.id)}>
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

      <div className="flex flex-col items-center gap-3 pt-2 pb-1">
        <div
          className={[
            'flex size-16 items-center justify-center rounded-2xl transition-all duration-500',
            isOn
              ? 'bg-state-light/20 text-state-light shadow-[0_0_24px_-4px_hsl(var(--state-light)/0.65)]'
              : 'bg-primary/10 text-primary/40',
          ].join(' ')}
        >
          {isPending ? (
            <Loader2 className="size-8 animate-spin" />
          ) : (
            <Lightbulb className={`size-8 transition-all duration-500 ${isOn ? 'animate-glow fill-state-light/40' : ''}`} />
          )}
        </div>

        <div className="text-center">
          <p
            className={`font-semibold leading-tight transition-colors duration-300 ${
              isOn ? 'text-foreground' : 'text-foreground/70'
            }`}
          >
            {light.name}
          </p>
          {light.model && <p className="mt-0.5 text-xs text-muted-foreground">{light.model}</p>}
          {isUnavailable && <p className="mt-1 text-xs text-amber-500">{t('unavailable')}</p>}
          {!canControl && <p className="mt-1 text-xs text-muted-foreground/50">{t('noHaEntity')}</p>}
        </div>

        {canControl && (
          <span
            className={[
              'rounded-full px-3 py-0.5 text-xs font-medium transition-all duration-300',
              isOn ? 'bg-state-light/20 text-state-light-fg' : 'bg-muted/60 text-muted-foreground',
            ].join(' ')}
          >
            {isOn ? t('turnOff') : t('turnOn')}
          </span>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function LightGrid({
  lights,
  haStates,
  pushPrefs,
  canManage,
}: {
  lights: Light[];
  haStates: HaStates;
  pushPrefs: Record<string, boolean>;
  canManage: boolean;
}) {
  const t = useTranslations('lights');
  const [editing, setEditing] = useState<EditableLightData | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);

  if (lights.length === 0) {
    return (
      <div className="glass flex animate-scale-in flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Lightbulb className="size-7 text-primary/60" />
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
      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {lights.map((light) => {
          const state = light.haEntityId ? haStates[light.haEntityId] : undefined;
          return (
            <LightCard
              key={light.id}
              light={light}
              initialState={state}
              onEdit={() => setEditing(light)}
              pushOn={pushPrefs[light.id] ?? false}
              canManage={canManage}
            />
          );
        })}
      </div>
      {editing && <EditLightDialog light={editing} onClose={closeEdit} />}
    </>
  );
}
