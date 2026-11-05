'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  Minus,
  Plus,
  Printer,
  Upload,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import {
  ACTIVE_JOB_STATES,
  PRINT_ACCEPT,
  PRINT_MAX_BYTES,
  PRINT_MAX_COPIES,
  type PrintColorMode,
  type PrintJob,
  type PrinterInk,
  type PrinterPanel,
  type PrinterStatus,
} from '@/lib/printer-types';

const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 20_000;
const NOTICE_MS = 6_000;

type Notice = { kind: 'ok' | 'error'; text: string };

/** Motivos de la impresora que merecen aviso. El resto (p. ej. "sleep") se calla. */
const KNOWN_REASONS = [
  'media-empty',
  'media-jam',
  'media-needed',
  'marker-supply-low',
  'marker-supply-empty',
  'door-open',
  'cover-open',
  'input-tray-missing',
  'offline',
] as const;

const KNOWN_ERRORS = [
  'forbidden',
  'printer_not_configured',
  'missing_file',
  'file_too_large',
  'unsupported_format',
  'invalid_copies',
  'invalid_page_ranges',
  'print_failed',
  'cancel_failed',
  'cups_unavailable',
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Sondeo que no se solapa consigo mismo y descansa con la pestaña oculta. */
function usePoll(load: () => Promise<void>, everyMs: number, enabled: boolean) {
  const inflight = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const tick = async () => {
      if (inflight.current || document.hidden) return;
      inflight.current = true;
      try {
        await load();
      } finally {
        inflight.current = false;
      }
    };
    void tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [load, everyMs, enabled]);
}

// ---------- Estado e tinta ----------------------------------------------------

function InkBar({ ink }: { ink: PrinterInk }) {
  const t = useTranslations('printer');
  const colors = ink.colors.length > 0 ? ink.colors : ['#888888'];
  // Un cartucho tricolor se pinta como las tres franjas de su color.
  const background =
    colors.length === 1
      ? colors[0]
      : `linear-gradient(90deg, ${colors
          .map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`)
          .join(', ')})`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{ink.name}</span>
        <span className={ink.low ? 'font-medium text-state-heat' : 'tabular-nums text-foreground'}>
          {ink.level === null ? t('inkUnknown') : `${ink.level}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/60">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${ink.level ?? 0}%`, background }}
        />
      </div>
    </div>
  );
}

function StatusCard({ status, loading }: { status: PrinterStatus | null; loading: boolean }) {
  const t = useTranslations('printer');

  const state = status?.state ?? 'offline';
  const tone =
    state === 'idle'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : state === 'processing'
        ? 'bg-primary/15 text-primary'
        : state === 'stopped'
          ? 'bg-destructive/15 text-destructive'
          : 'bg-muted text-muted-foreground';

  const reasons = (status?.reasons ?? []).filter((r): r is (typeof KNOWN_REASONS)[number] =>
    (KNOWN_REASONS as readonly string[]).includes(r),
  );

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div
          className={[
            'flex size-11 shrink-0 items-center justify-center rounded-xl',
            state === 'processing' ? 'bg-primary/15 text-primary' : 'bg-muted/60 text-muted-foreground',
          ].join(' ')}
        >
          <Printer className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{status?.model ?? t('defaultName')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {loading && !status ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> {t('loading')}
              </span>
            ) : (
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium leading-none ${tone}`}>
                {t(`state.${state}`)}
              </span>
            )}
            {status && status.queuedJobs > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('queued', { count: status.queuedJobs })}
              </span>
            )}
          </div>
        </div>
      </div>

      {status && !status.online && (
        <p className="mt-4 text-sm text-muted-foreground">{t('offlineHint')}</p>
      )}
      {status && !status.queueReady && (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t('queueNotReady')}
        </p>
      )}

      {reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {reasons.map((r) => (
            <li key={r} className="flex items-start gap-2 text-sm text-state-heat">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t(`reasons.${r}`)}
            </li>
          ))}
        </ul>
      )}

      {status && status.inks.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('ink')}</p>
          {status.inks.map((ink) => (
            <InkBar key={ink.name} ink={ink} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- Subida ------------------------------------------------------------

function UploadCard({
  disabled,
  onSubmitted,
  onNotice,
}: {
  disabled: boolean;
  onSubmitted: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const t = useTranslations('printer');
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<PrintColorMode>('color');
  const [pageRanges, setPageRanges] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isPdf = !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > PRINT_MAX_BYTES) {
      onNotice({ kind: 'error', text: t('errors.file_too_large') });
      return;
    }
    setFile(picked);
    setPageRanges('');
  };

  const clear = () => {
    setFile(null);
    setPageRanges('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || submitting) return;

    const body = new FormData();
    body.set('file', file);
    body.set('copies', String(copies));
    body.set('colorMode', colorMode);
    if (isPdf && pageRanges.trim()) body.set('pageRanges', pageRanges.trim());

    setSubmitting(true);
    try {
      const res = await fetch('/api/printer/jobs', { method: 'POST', body });
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) throw new Error(errorText(t, data.error, data.detail, res.status));
      onNotice({ kind: 'ok', text: t('sent', { name: file.name }) });
      clear();
      setCopies(1);
      onSubmitted();
    } catch (err) {
      onNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const FileIcon = file?.type.startsWith('image/') ? ImageIcon : FileText;

  return (
    <form onSubmit={submit} className="glass space-y-5 rounded-2xl p-5">
      <input
        ref={inputRef}
        id="print-file"
        type="file"
        accept={PRINT_ACCEPT}
        className="sr-only"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={submitting}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label={t('removeFile')}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <label
          htmlFor="print-file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition',
            dragging
              ? 'border-primary bg-primary/[0.06]'
              : 'border-border hover:border-primary/50 hover:bg-accent/40',
          ].join(' ')}
        >
          <Upload className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">{t('dropHere')}</span>
          <span className="text-xs text-muted-foreground">
            {t('formats', { size: formatBytes(PRINT_MAX_BYTES) })}
          </span>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('copies')}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCopies((c) => Math.max(1, c - 1))}
              disabled={copies <= 1}
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-background transition hover:bg-accent disabled:opacity-40"
              aria-label={t('fewerCopies')}
            >
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-sm font-medium tabular-nums">{copies}</span>
            <button
              type="button"
              onClick={() => setCopies((c) => Math.min(PRINT_MAX_COPIES, c + 1))}
              disabled={copies >= PRINT_MAX_COPIES}
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-background transition hover:bg-accent disabled:opacity-40"
              aria-label={t('moreCopies')}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('colorMode')}</p>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
            {(['color', 'monochrome'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setColorMode(mode)}
                aria-pressed={colorMode === mode}
                className={[
                  'rounded-md px-3 py-1.5 text-sm transition',
                  colorMode === mode
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {t(`mode.${mode}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isPdf && (
        <div className="space-y-1.5">
          <label htmlFor="print-pages" className="text-xs text-muted-foreground">
            {t('pages')}
          </label>
          <input
            id="print-pages"
            value={pageRanges}
            onChange={(e) => setPageRanges(e.target.value)}
            placeholder={t('pagesPlaceholder')}
            inputMode="numeric"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={!file || submitting || disabled}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
        {submitting ? t('sending') : t('print')}
      </button>
    </form>
  );
}

// ---------- Trabajos ----------------------------------------------------------

function JobRow({ job, onCancel, busy }: { job: PrintJob; onCancel: () => void; busy: boolean }) {
  const t = useTranslations('printer');
  const format = useFormatter();
  const active = ACTIVE_JOB_STATES.includes(job.state);

  const tone =
    job.state === 'completed'
      ? 'text-emerald-600 dark:text-emerald-400'
      : job.state === 'aborted' || job.state === 'stopped'
        ? 'text-destructive'
        : job.state === 'processing'
          ? 'text-primary'
          : 'text-muted-foreground';

  const when = job.completedAt ?? job.createdAt;

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
        {job.state === 'processing' ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : job.state === 'completed' ? (
          <Check className="size-4" />
        ) : (
          <FileText className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{job.name || t('untitled')}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className={tone}>{t(`jobState.${job.state}`)}</span>
          {when && <> · {format.relativeTime(new Date(when))}</>}
          {active && job.message && <> · {job.message}</>}
        </p>
      </div>
      {active && (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          aria-label={t('cancel')}
          title={t('cancel')}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        </button>
      )}
    </li>
  );
}

// ---------- Página ------------------------------------------------------------

function errorText(
  t: ReturnType<typeof useTranslations<'printer'>>,
  code: string | undefined,
  detail: string | undefined,
  status: number,
): string {
  if (code && (KNOWN_ERRORS as readonly string[]).includes(code)) {
    const base = t(`errors.${code as (typeof KNOWN_ERRORS)[number]}`);
    return detail && detail !== 'unknown' ? `${base} (${detail})` : base;
  }
  return detail ?? code ?? `HTTP ${status}`;
}

export function PrinterClient({ configured }: { configured: boolean }) {
  const t = useTranslations('printer');
  const [panel, setPanel] = useState<PrinterPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/printer', { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as PrinterPanel & { error?: string };
      if (res.ok) setPanel(data);
      else setPanel({ status: null, jobs: [], error: data.error ?? `HTTP ${res.status}` });
    } catch {
      setPanel((prev) => prev ?? { status: null, jobs: [], error: 'cups_unavailable' });
    } finally {
      setLoading(false);
    }
  }, []);

  const hasActive = panel?.jobs.some((j) => ACTIVE_JOB_STATES.includes(j.state)) ?? false;
  usePoll(load, hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS, configured);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  if (!configured) {
    return (
      <div className="glass rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{t('notConfigured')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('notConfiguredHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  const cancel = async (jobId: number) => {
    setCancelling(jobId);
    try {
      const res = await fetch(`/api/printer/jobs/${jobId}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) throw new Error(errorText(t, data.error, data.detail, res.status));
      setNotice({ kind: 'ok', text: t('cancelled') });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setCancelling(null);
    }
  };

  const jobs = panel?.jobs ?? [];

  return (
    /* `min-w-0` en las dos columnas: sin él, la columna de la rejilla crece
       hasta el nombre de archivo más largo (que no parte por sí solo) y en el
       móvil las tarjetas se salen de la pantalla. */
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0 space-y-5">
        {notice && (
          <div
            role="status"
            className={[
              'flex animate-fade-in items-start gap-2 rounded-xl border px-4 py-3 text-sm',
              notice.kind === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-destructive/30 bg-destructive/10 text-destructive',
            ].join(' ')}
          >
            {notice.kind === 'ok' ? (
              <Check className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <span className="min-w-0 break-words">{notice.text}</span>
          </div>
        )}

        <UploadCard
          disabled={panel?.error === 'cups_unavailable'}
          onSubmitted={() => void load()}
          onNotice={setNotice}
        />

        <section className="glass rounded-2xl p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('recent')}</p>
          {panel?.error === 'cups_unavailable' ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('errors.cups_unavailable')}</p>
          ) : jobs.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{loading ? t('loading') : t('noJobs')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border/60">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  busy={cancelling === job.id}
                  onCancel={() => void cancel(job.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <StatusCard status={panel?.status ?? null} loading={loading} />
      </div>
    </div>
  );
}
