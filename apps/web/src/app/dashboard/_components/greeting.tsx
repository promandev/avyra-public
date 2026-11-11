'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type Slot = 'morning' | 'afternoon' | 'evening';

function slotForHour(hour: number): Slot {
  if (hour < 6) return 'evening';
  if (hour < 13) return 'morning';
  if (hour < 21) return 'afternoon';
  return 'evening';
}

/**
 * Saludo según la hora local de quien mira.
 *
 * Se resuelve en el cliente a propósito: el servidor vive en la Raspberry y
 * su hora no tiene por qué coincidir con la del navegador. Hasta que monta,
 * la línea reserva su altura y entra con un fundido, así que no salta nada.
 */
export function Greeting({ name }: { name: string }) {
  const t = useTranslations('dashboard');
  const [slot, setSlot] = useState<Slot | null>(null);

  useEffect(() => {
    setSlot(slotForHour(new Date().getHours()));
  }, []);

  return (
    <p
      className="flex min-h-[1.5rem] items-center text-sm text-muted-foreground transition-opacity duration-500"
      style={{ opacity: slot ? 1 : 0 }}
    >
      {slot ? t(`greeting.${slot}` as Parameters<typeof t>[0], { name }) : ' '}
    </p>
  );
}
