'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';

import type { LitterCatInfo } from '@/lib/litter';
import { deleteLitterCat, saveLitterCat } from './actions';

interface Draft {
  key: string;
  id: string | null;
  name: string;
  weight: string;
}

const inputClass =
  'rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50';

const toDraft = (cat: LitterCatInfo): Draft => ({
  key: cat.id,
  id: cat.id,
  name: cat.name,
  weight: String(cat.referenceWeightKg),
});

/**
 * Gatos del hogar y su peso de referencia. Cada visita se asigna al gato de
 * peso más cercano, así que al cambiar un peso se recalculan las visitas que
 * nadie haya corregido a mano.
 */
export function LitterCatsDialog({ cats, onClose }: { cats: LitterCatInfo[]; onClose: () => void }) {
  const t = useTranslations('litter');
  const tc = useTranslations('common');
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() => cats.map(toDraft));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Tras guardar, la página vuelve con la lista nueva: se alinea con ella sin
  // perder las filas nuevas que aún no se han guardado.
  const [syncedCats, setSyncedCats] = useState(cats);
  if (syncedCats !== cats) {
    setSyncedCats(cats);
    setDrafts((prev) => [...cats.map(toDraft), ...prev.filter((d) => d.id === null)]);
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function run(key: string, action: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else onSuccess?.();
      setBusyKey(null);
      router.refresh();
    });
  }

  function save(draft: Draft) {
    const weight = Number(draft.weight.replace(',', '.'));
    // Una fila nueva guardada vuelve con la lista de la página: se quita el borrador.
    run(draft.key, () => saveLitterCat(draft.id, draft.name, weight), () => {
      if (!draft.id) setDrafts((prev) => prev.filter((d) => d.key !== draft.key));
    });
  }

  function remove(draft: Draft) {
    if (!draft.id) {
      setDrafts((prev) => prev.filter((d) => d.key !== draft.key));
      return;
    }
    run(draft.key, () => deleteLitterCat(draft.id!));
  }

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
            <h2 className="text-lg font-semibold">{t('catsTitle')}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent transition"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-4 p-6">
            <p className="text-sm text-muted-foreground">{t('catsHint')}</p>
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            {drafts.length === 0 && <p className="text-sm text-muted-foreground">{t('noCats')}</p>}

            <ul className="space-y-2">
              {drafts.map((draft) => {
                const original = cats.find((c) => c.id === draft.id);
                const dirty =
                  !original || original.name !== draft.name || String(original.referenceWeightKg) !== draft.weight;
                const busy = busyKey === draft.key;
                return (
                  <li key={draft.key} className="flex items-center gap-2">
                    <input
                      aria-label={t('catName')}
                      value={draft.name}
                      onChange={(e) => update(draft.key, { name: e.target.value })}
                      placeholder={t('catName')}
                      maxLength={40}
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <div className="relative w-24 shrink-0">
                      <input
                        aria-label={t('catWeight')}
                        value={draft.weight}
                        onChange={(e) => update(draft.key, { weight: e.target.value })}
                        inputMode="decimal"
                        placeholder="5.0"
                        className={`${inputClass} w-full pr-8 tnum`}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        kg
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => save(draft)}
                      disabled={!dirty || busy || draft.name.trim() === ''}
                      title={tc('save')}
                      className="rounded-md p-2 text-primary transition hover:bg-primary/10 disabled:opacity-30"
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(draft)}
                      disabled={busy}
                      title={tc('delete')}
                      className="rounded-md p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={() =>
                setDrafts((prev) => [...prev, { key: `new-${Date.now()}`, id: null, name: '', weight: '' }])
              }
              className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" />
              {t('addCat')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
