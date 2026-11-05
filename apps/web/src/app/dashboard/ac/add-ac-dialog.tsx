'use client';

import { useActionState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { addAc, type AddAcState } from './actions';

const initial: AddAcState = {};

export function AddAcDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(addAc, initial);
  const t = useTranslations('ac');
  const tc = useTranslations('common');

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="relative w-full max-w-md rounded-t-2xl rounded-b-none md:rounded-2xl bg-card shadow-2xl max-h-[90dvh] overflow-y-auto animate-sheet-up md:animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="md:hidden mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden />
          <div className="border-b border-border px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('addTitle')}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent transition"
            >
              <X className="size-4" />
            </button>
          </div>

          <form action={action} className="p-6 space-y-4">
            {state.error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="ac-name">
                {tc('name')} <span className="text-destructive">{tc('required')}</span>
              </label>
              <input
                id="ac-name"
                name="name"
                required
                placeholder={t('namePlaceholder')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="ac-model">
                {tc('model')}
              </label>
              <input
                id="ac-model"
                name="model"
                placeholder={t('modelPlaceholder')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="ac-ha">
                {tc('haEntity')}
              </label>
              <input
                id="ac-ha"
                name="haEntityId"
                placeholder={t('haPlaceholder')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground">
                {tc('haHelp')}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition"
              >
                {tc('cancel')}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {tc('save')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
