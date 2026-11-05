'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Cpu,
  Download,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  HardDrive,
  Link2,
  Loader2,
  MemoryStick,
  Pencil,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Thermometer,
  Timer,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import type {
  DirListing,
  FileContent,
  FileEntry,
  SecurityReport,
  SystemMetrics,
} from '@/lib/system-panel-types';

const METRICS_POLL_MS = 5_000;
const SECURITY_POLL_MS = 60_000;
/** El cron del host exporta cada 5 min; pasado esto se da por parado. */
const EXPORT_STALE_MS = 15 * 60_000;
const NOTICE_MS = 6_000;

const TABS = ['overview', 'files', 'security'] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab =>
  value !== null && (TABS as readonly string[]).includes(value);

type Notice = { kind: 'ok' | 'error'; text: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  return data as T;
}

const postJson = <T,>(url: string, body: unknown) =>
  request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

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

function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Verde hasta 70 %, ámbar hasta 90 %, rojo a partir de ahí. */
function toneFor(percent: number): string {
  if (percent >= 90) return 'bg-destructive';
  if (percent >= 70) return 'bg-state-heat';
  return 'bg-state-live';
}

function Bar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${toneFor(clamped)}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function Tile({
  icon,
  title,
  value,
  detail,
  percent,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  detail?: string;
  percent?: number | null;
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{detail}</p>}
      {percent !== undefined && percent !== null && <Bar percent={percent} label={title} />}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Resumen
// --------------------------------------------------------------------------- //

function Overview({ metrics, error }: { metrics: SystemMetrics | null; error: string | null }) {
  const t = useTranslations('system');
  const format = useFormatter();

  if (!metrics) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error ? <AlertTriangle className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
        {error ? t('loadError', { reason: error }) : t('loading')}
      </p>
    );
  }

  const na = t('unavailable');
  const { cpu, memory, swap, disk, uptimeSeconds } = metrics;
  const temp = cpu.temperatureC;
  // Por encima de 80 °C la Pi 4 empieza a bajar la frecuencia.
  const tempPercent = temp === null ? null : Math.min(100, (temp / 85) * 100);

  let uptime = na;
  if (uptimeSeconds !== null) {
    uptime = t('uptimeValue', {
      days: Math.floor(uptimeSeconds / 86_400),
      hours: Math.floor((uptimeSeconds % 86_400) / 3_600),
      minutes: Math.floor((uptimeSeconds % 3_600) / 60),
    });
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          icon={<Cpu className="size-4" />}
          title={t('cpu')}
          value={cpu.percent === null ? na : `${cpu.percent.toFixed(1)} %`}
          detail={[
            t('cores', { count: cpu.cores }),
            cpu.load ? t('load', { one: cpu.load[0], five: cpu.load[1], fifteen: cpu.load[2] }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          percent={cpu.percent}
        />
        <Tile
          icon={<Thermometer className="size-4" />}
          title={t('temperature')}
          value={temp === null ? na : `${temp.toFixed(1)} °C`}
          detail={temp !== null && temp >= 80 ? t('throttling') : undefined}
          percent={tempPercent}
        />
        <Tile
          icon={<MemoryStick className="size-4" />}
          title={t('memory')}
          value={memory ? `${memory.percent.toFixed(1)} %` : na}
          detail={
            memory
              ? t('usedOf', { used: formatBytes(memory.usedBytes), total: formatBytes(memory.totalBytes) })
              : undefined
          }
          percent={memory?.percent}
        />
        <Tile
          icon={<MemoryStick className="size-4" />}
          title={t('swap')}
          value={swap ? `${swap.percent.toFixed(1)} %` : na}
          detail={
            swap
              ? t('usedOf', { used: formatBytes(swap.usedBytes), total: formatBytes(swap.totalBytes) })
              : undefined
          }
          percent={swap?.percent}
        />
        <Tile
          icon={<HardDrive className="size-4" />}
          title={t('disk')}
          value={disk ? `${disk.percent.toFixed(1)} %` : na}
          detail={
            disk
              ? `${t('usedOf', { used: formatBytes(disk.usedBytes), total: formatBytes(disk.totalBytes) })} · ${t('free', { value: formatBytes(disk.freeBytes) })}`
              : undefined
          }
          percent={disk?.percent}
        />
        <Tile icon={<Timer className="size-4" />} title={t('uptime')} value={uptime} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {t('updated', { time: format.dateTime(new Date(metrics.generatedAt), { timeStyle: 'medium' }) })}
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Archivos
// --------------------------------------------------------------------------- //

function Editor({
  file,
  onClose,
  onSaved,
  onError,
}: {
  file: FileContent;
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (reason: string) => void;
}) {
  const t = useTranslations('system');
  const original = file.binary ? '' : file.content;
  const [text, setText] = useState(original);
  const [saving, setSaving] = useState(false);
  const readOnly = file.binary || file.truncated;
  const dirty = !readOnly && text !== original;

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await postJson('/api/system/files', { op: 'write', path: file.path, content: text });
      onSaved(t('files.saved'));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, file.path, text, onSaved, onError, t]);

  const close = () => {
    if (dirty && !window.confirm(t('files.unsaved'))) return;
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void save();
    }
  };

  return (
    <section className="glass mt-4 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-sm" title={file.path}>
          {file.path}
          {dirty && <span className="ml-1 text-state-heat">●</span>}
        </p>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t('files.save')}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label={t('files.close')}
            className="rounded-md p-1.5 transition hover:bg-accent/40"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      {file.binary ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('files.binary')}</p>
      ) : (
        <>
          {file.truncated && <p className="mt-3 text-sm text-state-heat-fg">{t('files.truncated')}</p>}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            aria-label={file.path}
            className="mt-3 h-[60vh] w-full resize-y rounded-md border border-border/60 bg-background/60 p-3 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
          />
        </>
      )}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 transition hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-destructive' : ''
      }`}
    >
      {children}
    </button>
  );
}

function Files({ root, notify }: { root: string | null; notify: (n: Notice) => void }) {
  const t = useTranslations('system');
  const format = useFormatter();
  const [listing, setListing] = useState<DirListing | null>(null);
  const [path, setPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<FileContent | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const fail = useCallback(
    (reason: string) => notify({ kind: 'error', text: t('files.error', { reason }) }),
    [notify, t],
  );

  const load = useCallback(
    async (target: string) => {
      try {
        const data = await request<DirListing>(
          `/api/system/files?op=list&path=${encodeURIComponent(target)}`,
        );
        setListing(data);
        setPath(data.path);
      } catch (err) {
        fail((err as Error).message);
      }
    },
    [fail],
  );

  const refresh = () => {
    setLoading(true);
    void load(path).finally(() => setLoading(false));
  };

  // Primera carga: sólo depende de la raíz, no de `load`, para que un cambio de
  // identidad de `t` no vuelva a pedir la carpeta en cada render.
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    request<DirListing>(`/api/system/files?op=list&path=${encodeURIComponent(root)}`)
      .then((data) => {
        if (cancelled) return;
        setListing(data);
        setPath(data.path);
      })
      .catch((err: Error) => {
        if (!cancelled) notify({ kind: 'error', text: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [root, notify]);

  if (!root) {
    return (
      <section className="glass rounded-2xl p-5">
        <p className="font-medium">{t('files.notConfigured')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('files.notConfiguredHint')}</p>
      </section>
    );
  }

  const run = async (action: () => Promise<unknown>, okText?: string) => {
    setBusy(true);
    try {
      await action();
      if (okText) notify({ kind: 'ok', text: okText });
      await load(path);
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = (name: string) => `${path.replace(/\/$/, '')}/${name}`;

  const create = (isDir: boolean) => {
    const name = window.prompt(t(isDir ? 'files.promptNewFolder' : 'files.promptNewFile'))?.trim();
    if (!name) return;
    void run(() => postJson('/api/system/files', { op: 'create', path: join(name), isDir }));
  };

  const renameEntry = (entry: FileEntry) => {
    const name = window.prompt(t('files.promptRename'), entry.name)?.trim();
    if (!name || name === entry.name) return;
    void run(() => postJson('/api/system/files', { op: 'rename', path: entry.path, newName: name }));
  };

  const remove = (entry: FileEntry) => {
    const question = t(entry.isDir ? 'files.confirmDeleteDir' : 'files.confirmDelete', {
      name: entry.name,
    });
    if (!window.confirm(question)) return;
    if (open?.path === entry.path) setOpen(null);
    void run(() => postJson('/api/system/files', { op: 'delete', path: entry.path }));
  };

  const upload = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set('dest', path);
    form.set('file', file);
    void run(
      () => request('/api/system/files/upload', { method: 'POST', body: form }),
      t('files.uploaded', { name: file.name }),
    ).finally(() => {
      if (uploadRef.current) uploadRef.current.value = '';
    });
  };

  const openFile = async (target: string) => {
    try {
      setOpen(await request<FileContent>(`/api/system/files?op=read&path=${encodeURIComponent(target)}`));
    } catch (err) {
      fail((err as Error).message);
    }
  };

  // Ruta relativa a la raíz, troceada en migas de pan navegables.
  const rel = listing ? path.slice(listing.root.length).split('/').filter(Boolean) : [];

  return (
    <div>
      <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3">
        <nav aria-label={t('files.location')} className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-sm">
          <button type="button" onClick={() => void load(root)} className="rounded px-1 hover:bg-accent/40">
            ~
          </button>
          {rel.map((part, i) => (
            <span key={`${i}-${part}`} className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <button
                type="button"
                onClick={() => void load(`${listing!.root}/${rel.slice(0, i + 1).join('/')}`)}
                className="rounded px-1 hover:bg-accent/40"
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <IconButton
            label={t('files.up')}
            onClick={() => listing?.parent && void load(listing.parent)}
            disabled={!listing?.parent || busy}
          >
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label={t('files.newFile')} onClick={() => create(false)} disabled={busy}>
            <FilePlus className="size-4" />
          </IconButton>
          <IconButton label={t('files.newFolder')} onClick={() => create(true)} disabled={busy}>
            <FolderPlus className="size-4" />
          </IconButton>
          <IconButton label={t('files.upload')} onClick={() => uploadRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          </IconButton>
          <IconButton label={t('files.refresh')} onClick={refresh} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
          <input
            ref={uploadRef}
            type="file"
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
        </div>
      </div>

      {open && (
        <Editor
          key={open.path}
          file={open}
          onClose={() => setOpen(null)}
          onSaved={(text) => {
            notify({ kind: 'ok', text });
            void openFile(open.path);
            void load(path);
          }}
          onError={fail}
        />
      )}

      <section className="glass mt-4 overflow-hidden rounded-2xl">
        {!listing ? (
          <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </p>
        ) : listing.entries.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('files.empty')}</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {listing.entries.map((entry) => (
              <li key={entry.path} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/20">
                <button
                  type="button"
                  onClick={() => (entry.isDir ? void load(entry.path) : void openFile(entry.path))}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  {entry.isDir ? (
                    <Folder className="size-4 shrink-0 text-state-light" />
                  ) : (
                    <File className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-sm">{entry.name}</span>
                  {entry.isSymlink && <Link2 className="size-3.5 shrink-0 text-muted-foreground" />}
                </button>
                <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                  {entry.isDir ? '' : formatBytes(entry.size)}
                </span>
                <span className="hidden w-36 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:block">
                  {entry.modified
                    ? format.dateTime(new Date(entry.modified), { dateStyle: 'short', timeStyle: 'short' })
                    : ''}
                </span>
                <span className="hidden w-24 shrink-0 font-mono text-xs text-muted-foreground lg:block">
                  {entry.mode}
                </span>
                <div className="flex shrink-0 items-center">
                  {!entry.isDir && (
                    <a
                      href={`/api/system/files/download?path=${encodeURIComponent(entry.path)}`}
                      title={t('files.download')}
                      aria-label={t('files.download')}
                      className="rounded-md p-1.5 transition hover:bg-accent/40"
                    >
                      <Download className="size-4" />
                    </a>
                  )}
                  <IconButton label={t('files.rename')} onClick={() => renameEntry(entry)} disabled={busy}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton label={t('files.delete')} onClick={() => remove(entry)} disabled={busy} danger>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Seguridad
// --------------------------------------------------------------------------- //

function Security({
  report,
  checkedAt,
  error,
}: {
  report: SecurityReport | null;
  /** Momento en que llegó el informe: la antigüedad se mide contra él. */
  checkedAt: number;
  error: string | null;
}) {
  const t = useTranslations('system');
  const format = useFormatter();

  if (!report) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error ? <AlertTriangle className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
        {error ? t('loadError', { reason: error }) : t('loading')}
      </p>
    );
  }

  const updated = report.updatedAt ? new Date(report.updatedAt) : null;
  const staleMinutes =
    updated && checkedAt - updated.getTime() > EXPORT_STALE_MS
      ? Math.round((checkedAt - updated.getTime()) / 60_000)
      : null;

  const alertText = (a: SecurityReport['alerts'][number]) => {
    switch (a.type) {
      case 'new_login_ip':
        return t('security.alertNewIp', { ip: a.ip, user: a.detail });
      case 'brute_force':
        return t('security.alertBrute', { ip: a.ip, count: a.count ?? 0 });
      case 'invalid_user_probe':
        return t('security.alertProbe', { ip: a.ip, users: a.detail });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="glass rounded-2xl p-5 lg:col-span-2">
        <h2 className="flex items-center gap-2 font-medium">
          {report.alerts.length ? (
            <ShieldAlert className="size-4 text-destructive" />
          ) : (
            <ShieldCheck className="size-4 text-state-live" />
          )}
          {t('security.alerts')}
        </h2>
        {!report.available ? (
          <div className="mt-2 text-sm">
            <p>{t('security.sourceMissing')}</p>
            <p className="mt-1 text-muted-foreground">{t('security.sourceMissingHint')}</p>
          </div>
        ) : (
          <>
            {staleMinutes !== null && (
              <p className="mt-2 text-sm text-state-heat-fg">
                {t('security.stale', { minutes: staleMinutes })}
              </p>
            )}
            {report.alerts.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('security.noAlerts')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {report.alerts.map((a, i) => (
                  <li
                    key={`${a.type}-${a.ip}-${i}`}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      a.severity === 'critical'
                        ? 'border-destructive/50 bg-destructive/10'
                        : 'border-state-heat/50 bg-state-heat/10'
                    }`}
                  >
                    {alertText(a)}
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ['failedAttempts', report.summary.failedAttempts],
                  ['attackerIps', report.summary.distinctAttackerIps],
                  ['successfulLogins', report.summary.successfulLogins],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border/60 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t(`security.${key}`)}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {updated && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('updated', { time: format.relativeTime(updated) })}
              </p>
            )}
          </>
        )}
      </section>

      {report.available && (
        <>
          <section className="glass rounded-2xl p-5">
            <h2 className="font-medium">{t('security.recentLogins')}</h2>
            {report.recentAccepted.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {report.recentAccepted.map((a, i) => (
                  <li key={`${a.at}-${i}`} className="flex flex-wrap justify-between gap-x-3">
                    <span className="font-mono">{a.ip}</span>
                    <span className="text-muted-foreground">
                      {a.user} · {a.method}
                      {a.at && ` · ${format.dateTime(new Date(a.at), { dateStyle: 'short', timeStyle: 'short' })}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass rounded-2xl p-5">
            <h2 className="font-medium">{t('security.topFailedIps')}</h2>
            <TopList rows={report.summary.topFailedIps} mono />
            <h2 className="mt-4 font-medium">{t('security.topFailedUsers')}</h2>
            <TopList rows={report.summary.topFailedUsers} />
          </section>
        </>
      )}

      <section className="glass rounded-2xl p-5 lg:col-span-2">
        <h2 className="font-medium">{t('security.events')}</h2>
        {report.events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('security.noEvents')}</p>
        ) : (
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/60 p-3 font-mono text-xs leading-relaxed">
            {report.events.join('\n')}
          </pre>
        )}
      </section>
    </div>
  );
}

function TopList({ rows, mono }: { rows: [string, number][]; mono?: boolean }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-muted-foreground">—</p>;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {rows.map(([name, count]) => (
        <li key={name} className="flex justify-between gap-3">
          <span className={`truncate ${mono ? 'font-mono' : ''}`}>{name}</span>
          <span className="tabular-nums text-muted-foreground">{count}</span>
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------------------- //
// Contenedor
// --------------------------------------------------------------------------- //

export function SystemClient({ filesRoot }: { filesRoot: string | null }) {
  const t = useTranslations('system');
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = searchParams.get('tab');
    return isTab(fromUrl) ? fromUrl : 'overview';
  });
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityReport | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securityCheckedAt, setSecurityCheckedAt] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const loadMetrics = useCallback(async () => {
    try {
      setMetrics(await request<SystemMetrics>('/api/system/metrics'));
      setMetricsError(null);
    } catch (err) {
      setMetricsError((err as Error).message);
    }
  }, []);

  const loadSecurity = useCallback(async () => {
    try {
      setSecurity(await request<SecurityReport>('/api/system/security'));
      setSecurityCheckedAt(Date.now());
      setSecurityError(null);
    } catch (err) {
      setSecurityError((err as Error).message);
    }
  }, []);

  usePoll(loadMetrics, METRICS_POLL_MS, tab === 'overview');
  usePoll(loadSecurity, SECURITY_POLL_MS, tab === 'security');

  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(tab);
    if (e.key === 'ArrowRight') select(TABS[(index + 1) % TABS.length]!);
    else if (e.key === 'ArrowLeft') select(TABS[(index - 1 + TABS.length) % TABS.length]!);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={t('title')}
        onKeyDown={onTabKey}
        className="mb-6 inline-flex rounded-full border border-border/60 p-1"
      >
        {TABS.map((id) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              id={`system-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="system-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(id)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                selected ? 'bg-foreground text-background' : 'hover:bg-accent/40'
              }`}
            >
              {t(`tabs.${id}`)}
            </button>
          );
        })}
      </div>

      {notice && (
        <p
          role="status"
          className={`mb-4 rounded-md border px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'border-destructive/50 bg-destructive/10'
              : 'border-state-live/50 bg-state-live/10'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div id="system-panel" role="tabpanel" aria-labelledby={`system-tab-${tab}`}>
        {tab === 'overview' && <Overview metrics={metrics} error={metricsError} />}
        {tab === 'files' && <Files root={filesRoot} notify={setNotice} />}
        {tab === 'security' && <Security report={security} checkedAt={securityCheckedAt} error={securityError} />}
      </div>
    </div>
  );
}
