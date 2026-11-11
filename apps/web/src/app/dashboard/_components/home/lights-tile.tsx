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
 *
 * Encendida, la pieza entera se rellena de oro: se distingue desde lejos sin
 * leer nada. Apagada es una superficie neutra más.
 */
function LightSwitch({ light }: { light: LightOverview }) {
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
        'flex min-h-[3.75rem] min-w-0 items-center gap-3 rounded-2xl px-4 py-3 text-left',
        'transition-[background-color,border-color,color,transform] duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        on
          ? 'border border-transparent bg-state-light text-state-on'
          : 'surface text-foreground hover:bg-accent/60',
        // Sin conexión: se apaga la superficie, no el texto, que es lo único
        // que dice que el aparato no responde.
        disabled
          ? 'cursor-not-allowed border-dashed bg-transparent shadow-none hover:bg-transparent'
          : 'cursor-pointer active:scale-[0.98]',
        failed ? 'ring-2 ring-destructive' : '',
      ].join(' ')}
    >
      {pending ? (
        <Loader2 className="size-5 shrink-0 animate-spin" />
      ) : (
        <Lightbulb className={`size-5 shrink-0 ${on ? 'fill-current' : 'text-muted-foreground'}`} />
      )}
      <span className="min-w-0">
        <span
          className={`line-clamp-2 break-words font-medium leading-snug ${disabled ? 'text-muted-foreground' : ''}`}
        >
          {light.name}
        </span>
        <span
          className={[
            'block text-sm leading-snug',
            failed ? 'font-medium' : '',
            on ? (failed ? 'text-state-on' : 'text-state-on/75') : failed ? 'text-destructive' : 'text-muted-foreground',
          ].join(' ')}
          aria-live="polite"
        >
          {disabled ? t('lightUnavailable') : failed ? t('lightFailed') : on ? t('lightOn') : t('lightOff')}
        </span>
      </span>
    </button>
  );
}

export function LightsTileBody({ lights, wide = false }: { lights: LightOverview[]; wide?: boolean }) {
  return (
    <div
      className={[
        'grid grid-cols-2 gap-3',
        // Sin columna vecina, las luces aprovechan todo el ancho.
        wide ? 'md:grid-cols-3 xl:grid-cols-4' : 'md:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3',
      ].join(' ')}
    >
      {lights.map((light) => (
        <LightSwitch key={light.id} light={light} />
      ))}
    </div>
  );
}
