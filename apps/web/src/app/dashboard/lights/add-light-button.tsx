'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AddLightDialog } from './add-light-dialog';

export function AddLightButton() {
  const t = useTranslations('lights');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90"
      >
        <Plus className="size-4" />
        {t('addLight')}
      </button>
      {open && <AddLightDialog onClose={close} />}
    </>
  );
}
