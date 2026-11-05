'use client';

import { useCallback, useState } from 'react';
import { Cat, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { LitterCatInfo } from '@/lib/litter';
import { LitterCatsDialog } from './cats-dialog';
import { LitterFormDialog } from './litter-form-dialog';

/** Botones de cabecera para dueños y administradores: gatos y alta de arenero. */
export function LitterHeaderActions({ cats }: { cats: LitterCatInfo[] }) {
  const t = useTranslations('litter');
  const [open, setOpen] = useState<'add' | 'cats' | null>(null);
  const close = useCallback(() => setOpen(null), []);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen('cats')}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent"
      >
        <Cat className="size-4" />
        {t('cats')}
      </button>
      <button
        type="button"
        onClick={() => setOpen('add')}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90"
      >
        <Plus className="size-4" />
        {t('addLitter')}
      </button>
      {open === 'add' && <LitterFormDialog onClose={close} />}
      {open === 'cats' && <LitterCatsDialog cats={cats} onClose={close} />}
    </div>
  );
}
