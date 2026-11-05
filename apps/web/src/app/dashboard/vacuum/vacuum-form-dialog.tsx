'use client';

import { useActionState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { addVacuum, editVacuum, type VacuumFormState } from './actions';

const initial: VacuumFormState = {};

export interface EditableVacuumData {
  id: string;
  name: string;
  model: string | null;
  haEntityId: string | null;
  waterTankEntityId: string | null;
  batteryEntityId: string | null;
  cleanTimeEntityId: string | null;
  cleanAreaEntityId: string | null;
}

function Field({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  help,
  required,
  mono,
}: {
  id: string;
  name: string;
  label: React.ReactNode;
  defaultValue?: string | null;
  placeholder?: string;
  help?: string;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className={`w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 ${mono ? 'font-mono' : ''}`}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Alta y edición comparten formulario: sólo cambia la acción y los valores iniciales. */
export function VacuumFormDialog({
  vacuum,
  onClose,
}: {
  vacuum?: EditableVacuumData;
  onClose: () => void;
}) {
  const formAction = vacuum ? editVacuum.bind(null, vacuum.id) : addVacuum;
  const [state, action, pending] = useActionState(formAction, initial);
  const t = useTranslations('vacuum');
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

  const prefix = vacuum ? 'edit-vacuum' : 'vacuum';

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
            <h2 className="text-lg font-semibold">{vacuum ? t('editTitle') : t('addTitle')}</h2>
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

            <Field
              id={`${prefix}-name`}
              name="name"
              required
              label={
                <>
                  {tc('name')} <span className="text-destructive">{tc('required')}</span>
                </>
              }
              defaultValue={vacuum?.name}
              placeholder={t('namePlaceholder')}
            />
            <Field
              id={`${prefix}-model`}
              name="model"
              label={tc('model')}
              defaultValue={vacuum?.model}
              placeholder={t('modelPlaceholder')}
            />
            <Field
              id={`${prefix}-ha`}
              name="haEntityId"
              label={tc('haEntity')}
              defaultValue={vacuum?.haEntityId}
              placeholder={t('haPlaceholder')}
              help={t('haHelp')}
              mono
            />
            <Field
              id={`${prefix}-water`}
              name="waterTankEntityId"
              label={t('waterTankEntity')}
              defaultValue={vacuum?.waterTankEntityId}
              placeholder={t('waterTankPlaceholder')}
              help={t('waterTankHelp')}
              mono
            />
            <Field
              id={`${prefix}-battery`}
              name="batteryEntityId"
              label={t('batteryEntity')}
              defaultValue={vacuum?.batteryEntityId}
              placeholder={t('batteryPlaceholder')}
              help={t('batteryHelp')}
              mono
            />
            <Field
              id={`${prefix}-clean-time`}
              name="cleanTimeEntityId"
              label={t('cleanTimeEntity')}
              defaultValue={vacuum?.cleanTimeEntityId}
              placeholder={t('cleanTimePlaceholder')}
              help={t('cleanTimeHelp')}
              mono
            />
            <Field
              id={`${prefix}-clean-area`}
              name="cleanAreaEntityId"
              label={t('cleanAreaEntity')}
              defaultValue={vacuum?.cleanAreaEntityId}
              placeholder={t('cleanAreaPlaceholder')}
              help={t('cleanAreaHelp')}
              mono
            />

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
