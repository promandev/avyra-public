'use client';

import { useOptimistic, useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lightbulb, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { LightOverview } from '@/lib/home-pulse-types';
import { toggleLight } from '../../lights/actions';

/**
 * Una luz como interruptor.
 *
 * Se enciende y se apaga desde la portada: es lo que más se toca y no tiene
 * sentido entrar en otra pantalla para ello. Es la misma acción que usa la
 * sección de Luces, con los mismos permisos. Tras el cambio se refresca la
 * ruta para que el halo del fondo y el menú se enteren.
 */
function LightChip({ light }: { light: LightOverview }) {
  const t = useTranslations('dashboard.tiles');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOptimisticOn] = useOptimistic(light.on);
  const [failed, setFailed] = useState(false);

  const disabled = !light.controllable || !light.available;

  function toggle() {
    if (disabled || pending) return;
    setFailed(false);
    startTransition(async () => {
      setOptimisticOn(!on);
      const result = await toggleLight(light.id);
      if (result.error) setFailed(true);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={on}
      title={disabled ? t('lightUnavailable') : t('tapToToggle')}
      className={[
        'group flex min-w-0 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all duration-500',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on
          ? 'border-state-light/40 bg-state-light/10 shadow-[0_0_28px_-10px_hsl(var(--state-light)/0.7)]'
          : 'border-border/60 bg-foreground/[0.03] hover:border-border hover:bg-foreground/[0.06]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:scale-[0.97]',
        failed ? 'ring-1 ring-destructive/60' : '',
      ].join(' ')}
    >
      <span
        className={[
          'flex size-9 shrink-0 items-center justify-center rounded-xl transition-all duration-500',
          on ? 'bg-state-light/20 text-state-light' : 'bg-muted/70 text-muted-foreground',
        ].join(' ')}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Lightbulb className={`size-4 transition-all ${on ? 'animate-glow fill-state-light/40' : ''}`} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{light.name}</span>
        <span className={`block text-xs ${on ? 'text-state-light-fg' : 'text-muted-foreground'}`}>
          {on ? t('lightOn') : t('lightOff')}
        </span>
      </span>
    </button>
  );
}

export function LightsTileBody({ lights }: { lights: LightOverview[] }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
      {lights.map((light) => (
        <LightChip key={light.id} light={light} />
      ))}
    </div>
  );
}
