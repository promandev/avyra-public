'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Globe, Home, Monitor, Server } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface LogRow {
  id: string;
  at: string;
  camera: string;
  source: string;
  level: string;
  stage: string;
  httpStatus: number | null;
  network: string | null;
  message: string;
  detail: Record<string, unknown> | null;
}

/**
 * Lista del registro de fallos. Va en cliente para mostrar la hora en la zona
 * del navegador (el servidor corre en UTC) y poder desplegar el detalle.
 * Tarjetas en vez de tabla: se consulta sobre todo desde el móvil.
 */
export function LogTable({ rows }: { rows: LogRow[] }) {
  const t = useTranslations('cameraLog');
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const isOpen = open === r.id;
        const hasDetail = !!r.detail && Object.keys(r.detail).length > 0;
        return (
          <li
            key={r.id}
            className={[
              'glass rounded-xl border-l-4 px-4 py-3',
              r.level === 'error'
                ? 'border-l-destructive'
                : r.level === 'warn'
                  ? 'border-l-amber-500'
                  : 'border-l-border',
            ].join(' ')}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <time dateTime={r.at} suppressHydrationWarning className="tabular-nums text-foreground">
                {new Date(r.at).toLocaleString(undefined, {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
              <span className="font-medium text-foreground">{r.camera}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{r.stage}</span>
              {r.httpStatus != null && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{r.httpStatus}</span>
              )}
              <span className="inline-flex items-center gap-1" title={t(r.source === 'client' ? 'sourceClient' : 'sourceServer')}>
                {r.source === 'client' ? <Monitor className="size-3" /> : <Server className="size-3" />}
                {t(r.source === 'client' ? 'sourceClient' : 'sourceServer')}
              </span>
              {r.network && (
                <span className="inline-flex items-center gap-1">
                  {r.network === 'external' ? <Globe className="size-3" /> : <Home className="size-3" />}
                  {t(r.network === 'external' ? 'netExternal' : 'netLan')}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-start gap-1 text-sm">
              {hasDetail ? (
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="flex items-start gap-1 text-left hover:text-primary"
                >
                  {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
                  <span className="break-words">{r.message}</span>
                </button>
              ) : (
                <span className="break-words pl-5">{r.message}</span>
              )}
            </div>
            {isOpen && hasDetail && (
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed">
                {JSON.stringify(r.detail, null, 2)}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}
