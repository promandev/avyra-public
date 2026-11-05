'use client';

import { useActionState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LITTER_DURATION_MODES } from '@/lib/litter';
import { addLitterBox, editLitterBox, type LitterFormState } from './actions';

const initial: LitterFormState = {};

export interface EditableLitterData {
  id: string;
  name: string;
  model: string | null;
  haEntityId: string | null;
  cleanEntityId: string | null;
  emptyEntityId: string | null;
  resetEntityId: string | null;
  autoCleanEntityId: string | null;
  cleanDelayEntityId: string | null;
  weightEntityId: string | null;
  visitsEntityId: string | null;
  durationEntityId: string | null;
  durationMode: string;
  faultEntityIds: string[];
  poopMinSeconds: number;
}

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50';

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
        className={`${inputClass} ${mono ? 'font-mono' : ''}`}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-border/60 pt-4">
      <legend className="pr-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Alta y edición comparten formulario: sólo cambia la acción y los valores iniciales. */
export function LitterFormDialog({
  unit,
  onClose,
}: {
  unit?: EditableLitterData;
  onClose: () => void;
}) {
  const formAction = unit ? editLitterBox.bind(null, unit.id) : addLitterBox;
  const [state, action, pending] = useActionState(formAction, initial);
  const t = useTranslations('litter');
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

  const prefix = unit ? 'edit-litter' : 'litter';

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
            <h2 className="text-lg font-semibold">{unit ? t('editTitle') : t('addTitle')}</h2>
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
              defaultValue={unit?.name}
              placeholder={t('namePlaceholder')}
            />
            <Field
              id={`${prefix}-model`}
              name="model"
              label={tc('model')}
              defaultValue={unit?.model}
              placeholder={t('modelPlaceholder')}
            />
            <Field
              id={`${prefix}-status`}
              name="haEntityId"
              label={t('statusEntity')}
              defaultValue={unit?.haEntityId}
              placeholder="sensor.arenero_estado"
              help={t('statusHelp')}
              mono
            />

            <Section title={t('sectionActions')}>
              <p className="text-xs text-muted-foreground">{t('actionHelp')}</p>
              <Field
                id={`${prefix}-clean`}
                name="cleanEntityId"
                label={t('clean')}
                defaultValue={unit?.cleanEntityId}
                placeholder="button.arenero_limpieza_manual"
                mono
              />
              <Field
                id={`${prefix}-empty`}
                name="emptyEntityId"
                label={t('empty')}
                defaultValue={unit?.emptyEntityId}
                placeholder="switch.arenero_vaciar"
                mono
              />
              <Field
                id={`${prefix}-reset`}
                name="resetEntityId"
                label={t('reset')}
                defaultValue={unit?.resetEntityId}
                placeholder="button.arenero_reiniciar"
                help={t('resetHelp')}
                mono
              />
            </Section>

            <Section title={t('sectionAutoClean')}>
              <Field
                id={`${prefix}-auto-clean`}
                name="autoCleanEntityId"
                label={t('autoCleanEntity')}
                defaultValue={unit?.autoCleanEntityId}
                placeholder="switch.arenero_limpieza_automatica"
                mono
              />
              <Field
                id={`${prefix}-clean-delay`}
                name="cleanDelayEntityId"
                label={t('cleanDelayEntity')}
                defaultValue={unit?.cleanDelayEntityId}
                placeholder="number.arenero_retrasar_el_tiempo_de_limpieza"
                help={t('cleanDelayHelp')}
                mono
              />
            </Section>

            <Section title={t('sectionVisits')}>
              <Field
                id={`${prefix}-visits`}
                name="visitsEntityId"
                label={t('visitsEntity')}
                defaultValue={unit?.visitsEntityId}
                placeholder="sensor.arenero_veces_hoy"
                help={t('visitsHelp')}
                mono
              />
              <Field
                id={`${prefix}-weight`}
                name="weightEntityId"
                label={t('weightEntity')}
                defaultValue={unit?.weightEntityId}
                placeholder="sensor.arenero_peso_del_gato"
                help={t('weightHelp')}
                mono
              />
              <Field
                id={`${prefix}-duration`}
                name="durationEntityId"
                label={t('durationEntity')}
                defaultValue={unit?.durationEntityId}
                placeholder="sensor.arenero_tiempo_hoy"
                mono
              />
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`${prefix}-duration-mode`}>
                  {t('durationMode')}
                </label>
                <select
                  id={`${prefix}-duration-mode`}
                  name="durationMode"
                  defaultValue={unit?.durationMode ?? 'daily_total'}
                  className={inputClass}
                >
                  {LITTER_DURATION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`durationMode_${mode}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`${prefix}-poop`}>
                  {t('poopMinSeconds')}
                </label>
                <input
                  id={`${prefix}-poop`}
                  name="poopMinSeconds"
                  type="number"
                  min={10}
                  max={1800}
                  step={5}
                  defaultValue={unit?.poopMinSeconds ?? 90}
                  className={`${inputClass} tnum`}
                />
                <p className="text-xs text-muted-foreground">{t('poopMinHelp')}</p>
              </div>
            </Section>

            <Section title={t('sectionAlerts')}>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`${prefix}-faults`}>
                  {t('faultEntities')}
                </label>
                <textarea
                  id={`${prefix}-faults`}
                  name="faultEntityIds"
                  rows={3}
                  defaultValue={unit?.faultEntityIds.join('\n') ?? ''}
                  placeholder={'binary_sensor.arenero_bolsa_llena\nbinary_sensor.arenero_cajon_fuera'}
                  className={`${inputClass} font-mono`}
                />
                <p className="text-xs text-muted-foreground">{t('faultHelp')}</p>
              </div>
            </Section>

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
