'use client';

import { useState, useTransition } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { setDevicePush } from './device-push-actions';

/**
 * Interruptor discreto de avisos push de un aparato, para la cabecera de su
 * tarjeta. Pinta el valor optimista y vuelve atrás si el servidor lo rechaza.
 */
export function DevicePushToggle({ deviceId, initial }: { deviceId: string; initial: boolean }) {
  const t = useTranslations('common');
  const [on, setOn] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const result = await setDevicePush(deviceId, next);
      if (result.error) setOn(!next);
    });
  }

  const label = on ? t('pushOn') : t('pushOff');
  const Icon = on ? Bell : BellOff;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={toggle}
      disabled={isPending}
      className="inline-flex items-center gap-1 rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
    >
      <Icon className="size-3.5" />
      <span
        aria-hidden
        className={`relative h-3.5 w-6 rounded-full transition-colors ${on ? 'bg-primary/70' : 'bg-muted-foreground/30'}`}
      >
        <span
          className={`absolute top-0.5 size-2.5 rounded-full bg-background shadow-sm transition-all ${on ? 'left-3' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
