'use client';

import { useActionState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { editCamera, type EditCameraState } from './actions';

const initial: EditCameraState = {};

export interface EditableCameraData {
  id: string;
  name: string;
  model: string | null;
  snapshotUrl: string | null;
  rtspUrl: string | null;
  go2rtcStreamId: string | null;
}

export function EditCameraDialog({
  camera,
  onClose,
}: {
  camera: EditableCameraData;
  onClose: () => void;
}) {
  const boundAction = editCamera.bind(null, camera.id);
  const [state, action, pending] = useActionState(boundAction, initial);
  const t = useTranslations('cameras');
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
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="fixed inset-0 flex items-end justify-center p-0 md:items-center md:p-4" onClick={onClose}>
        <div
          className="relative w-full max-w-lg rounded-t-2xl rounded-b-none md:rounded-2xl bg-card shadow-2xl max-h-[90dvh] overflow-y-auto animate-sheet-up md:animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="md:hidden mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden />
          <div className="border-b border-border px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('editTitle')}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="p-6">
            <form action={action} className="space-y-4">
              <Field
                label={t('nameLabel')}
                name="name"
                defaultValue={camera.name}
                placeholder={t('namePlaceholder')}
              />
              <Field
                label={tc('model')}
                name="model"
                defaultValue={camera.model ?? ''}
                placeholder={t('modelPlaceholder')}
              />

              <div className="space-y-1.5">
                <label
                  htmlFor="snapshotUrl"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  {t('snapshotUrlLabel')}
                </label>
                <input
                  id="snapshotUrl"
                  name="snapshotUrl"
                  type="url"
                  placeholder={t('snapshotUrlPlaceholder')}
                  defaultValue={camera.snapshotUrl ?? ''}
                  className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </div>

              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronDown className="size-3.5 transition group-open:rotate-180" />
                  {t('advancedOptions')}
                </summary>
                <div className="mt-3 space-y-3 pl-1">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="rtspUrl"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      {t('rtspUrlLabel')}
                    </label>
                    <input
                      id="rtspUrl"
                      name="rtspUrl"
                      type="url"
                      placeholder={t('rtspUrlPlaceholder')}
                      defaultValue={camera.rtspUrl ?? ''}
                      className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="go2rtcStreamId"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      {t('go2rtcLabel')}
                    </label>
                    <input
                      id="go2rtcStreamId"
                      name="go2rtcStreamId"
                      placeholder={t('go2rtcPlaceholder')}
                      defaultValue={camera.go2rtcStreamId ?? ''}
                      className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </div>
              </details>

              {state.error && (
                <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {state.error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-40"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? tc('saving') : tc('saveChanges')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="text"
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}
