import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { getDb, cameraDiagLog, cameras, devices } from '@pradomotica/db';
import { PageHeader } from '../../_components/page-header';
import { LogTable, type LogRow } from './log-table';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('cameraLog');
  return { title: t('title') };
}

const PERIODS = { '24': 24, '72': 72, '168': 168, '336': 336 } as const;
const LEVELS = { all: ['error', 'warn', 'info'], warn: ['error', 'warn'], error: ['error'] } as const;

export default async function CameraLogPage({
  searchParams,
}: {
  searchParams: Promise<{ camera?: string; level?: string; hours?: string }>;
}) {
  // El layout ya ha comprobado que es super admin.
  const t = await getTranslations('cameraLog');
  const sp = await searchParams;
  const hours = PERIODS[sp.hours as keyof typeof PERIODS] ?? 72;
  const levelKey = (sp.level && sp.level in LEVELS ? sp.level : 'warn') as keyof typeof LEVELS;
  const cameraId = sp.camera || null;

  const db = getDb();
  const cameraList = await db
    .select({ id: devices.id, name: devices.name })
    .from(devices)
    .innerJoin(cameras, eq(cameras.deviceId, devices.id))
    .orderBy(devices.createdAt);
  const names = new Map(cameraList.map((c) => [c.id, c.name]));

  const where = and(
    gte(cameraDiagLog.occurredAt, sql`now() - make_interval(hours => ${hours})`),
    inArray(cameraDiagLog.level, [...LEVELS[levelKey]]),
    cameraId ? eq(cameraDiagLog.deviceId, cameraId) : undefined,
  );

  const [rows, summary] = await Promise.all([
    db.select().from(cameraDiagLog).where(where).orderBy(desc(cameraDiagLog.occurredAt)).limit(400),
    db
      .select({
        deviceId: cameraDiagLog.deviceId,
        stage: cameraDiagLog.stage,
        level: cameraDiagLog.level,
        n: count(),
      })
      .from(cameraDiagLog)
      .where(where)
      .groupBy(cameraDiagLog.deviceId, cameraDiagLog.stage, cameraDiagLog.level),
  ]);

  const tableRows: LogRow[] = rows.map((r) => ({
    id: r.id,
    at: r.occurredAt.toISOString(),
    camera: names.get(r.deviceId) ?? r.deviceId.slice(-6),
    source: r.source,
    level: r.level,
    stage: r.stage,
    httpStatus: r.httpStatus,
    network: r.network,
    message: r.message,
    detail: r.detail ?? null,
  }));

  const selectClass =
    'rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm outline-none focus:border-ring';

  return (
    <div className="container py-10">
      <Link
        href="/dashboard/cameras"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t('back')}
      </Link>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Filtros: GET puro, funciona sin JS y deja la URL compartible. */}
      <form className="glass mb-6 flex flex-wrap items-end gap-3 rounded-2xl p-4" method="get">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('camera')}
          <select name="camera" defaultValue={cameraId ?? ''} className={selectClass}>
            <option value="">{t('allCameras')}</option>
            {cameraList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('level')}
          <select name="level" defaultValue={levelKey} className={selectClass}>
            <option value="error">{t('levelError')}</option>
            <option value="warn">{t('levelWarn')}</option>
            <option value="all">{t('levelAll')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('period')}
          <select name="hours" defaultValue={String(hours)} className={selectClass}>
            <option value="24">{t('h24')}</option>
            <option value="72">{t('h72')}</option>
            <option value="168">{t('d7')}</option>
            <option value="336">{t('d14')}</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
        >
          {t('apply')}
        </button>
      </form>

      {summary.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium">{t('summary')}</h2>
          <div className="flex flex-wrap gap-2">
            {summary
              .sort((a, b) => b.n - a.n)
              .map((s) => (
                <span
                  key={`${s.deviceId}-${s.stage}-${s.level}`}
                  className={[
                    'rounded-full border px-2.5 py-1 text-xs',
                    s.level === 'error'
                      ? 'border-destructive/40 text-destructive'
                      : s.level === 'warn'
                        ? 'border-amber-500/40 text-amber-500'
                        : 'border-border text-muted-foreground',
                  ].join(' ')}
                >
                  {names.get(s.deviceId) ?? s.deviceId.slice(-6)} · {s.stage} · {s.n}
                </span>
              ))}
          </div>
        </section>
      )}

      <LogTable rows={tableRows} />

      <p className="mt-6 max-w-3xl text-xs text-muted-foreground">{t('legend')}</p>
    </div>
  );
}
