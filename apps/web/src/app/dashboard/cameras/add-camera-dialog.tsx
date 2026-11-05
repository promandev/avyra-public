'use client';

import { useActionState, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Radio, Check, X, ChevronDown, Search, Wifi, WifiOff, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { addCamera, addTabletCamera, type AddCameraState, type AddTabletCameraState } from './actions';

const initial: AddCameraState = {};
const tabletInitial: AddTabletCameraState = {};

type Discovered = {
  ip: string;
  snapshotUrl: string;
  name: string;
  model: string | null;
};

type ProbeResult = {
  ip: string;
  reachable: boolean;
  snapshotFound: boolean;
  snapshotUrl: string | null;
  results: {
    path: string;
    label: string;
    status: number | null;
    contentType: string | null;
    isImage: boolean;
    error: string | null;
  }[];
};

export function AddCameraDialog({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(addCamera, initial);
  const [tabletState, tabletAction, tabletPending] = useActionState(addTabletCamera, tabletInitial);
  const t = useTranslations('cameras');
  const tc = useTranslations('common');

  const [isTablet, setIsTablet] = useState(false);
  const [tabletName, setTabletName] = useState('');
  const [tabletIp, setTabletIp] = useState('');
  const [tabletPort, setTabletPort] = useState('');
  const [tabletUser, setTabletUser] = useState('');
  const [tabletPass, setTabletPass] = useState('');

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [go2rtcStreamId, setGo2rtcStreamId] = useState('');

  // Escáner automático
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Diagnóstico manual por IP
  const [probeIp, setProbeIp] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  useEffect(() => {
    if (tabletState.success) onClose();
  }, [tabletState.success, onClose]);

  // Cerrar con ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setDiscovered([]);
    setProbeResult(null);
    try {
      const res = await fetch('/api/cameras/discover');
      if (!res.ok) throw new Error(t('scanError'));
      const data: { cameras: Discovered[]; subnets: string[] } = await res.json();
      setDiscovered(data.cameras);
      if (data.cameras.length === 0) {
        setScanError(
          t('noCamerasFound', { subnets: data.subnets.map((s) => s + '.x').join(', ') }),
        );
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setScanning(false);
    }
  }, []);

  const probe = useCallback(async () => {
    if (!probeIp) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch(`/api/cameras/probe?ip=${encodeURIComponent(probeIp)}`);
      const data: ProbeResult = await res.json();
      setProbeResult(data);
      // Si encontró snapshot, autorellenar
      if (data.snapshotFound && data.snapshotUrl) {
        setSnapshotUrl(data.snapshotUrl);
        setName(`Cámara ${data.ip}`);
        // Auto-rellenar URL RTSP estándar de yi-hack
        setRtspUrl(`rtsp://${data.ip}/ch0_0.h264`);
      }
    } catch {
      // ignore
    } finally {
      setProbing(false);
    }
  }, [probeIp]);

  const selectCamera = useCallback((cam: Discovered) => {
    setSelected(cam.ip);
    setName(cam.name);
    setModel(cam.model ?? '');
    setSnapshotUrl(cam.snapshotUrl);
    // Auto-rellenar URL RTSP estándar de yi-hack
    setRtspUrl(`rtsp://${cam.ip}/ch0_0.h264`);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="fixed inset-0 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="relative w-full max-w-lg rounded-t-2xl rounded-b-none md:rounded-2xl bg-card shadow-2xl animate-sheet-up md:animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="md:hidden mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden />
          <div className="border-b border-border px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('addCamera')}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="max-h-[80vh] overflow-y-auto p-6 space-y-5">
        {/* ── Selector de modo — solo admin ── */}
        {isAdmin && (
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setIsTablet(false)}
              className={[
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 font-medium transition',
                !isTablet ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              ].join(' ')}
            >
              <Wifi className="size-3.5" />
              {t('tabletModeIp')}
            </button>
            <button
              type="button"
              onClick={() => setIsTablet(true)}
              className={[
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 font-medium transition',
                isTablet ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              ].join(' ')}
            >
              <Smartphone className="size-3.5" />
              {t('tabletModeTablet')}
            </button>
          </div>
        )}

        {isTablet ? (
          /* ── Formulario tablet ── */
          <form action={tabletAction} className="space-y-4">
            <p className="text-xs text-muted-foreground">{t('tabletDescription')}</p>
            <Field
              label={t('nameLabel')}
              name="name"
              placeholder={t('tabletNamePlaceholder')}
              value={tabletName}
              onChange={setTabletName}
            />
            <Field
              label={t('tabletIpLabel')}
              name="ip"
              placeholder="192.168.1.x"
              value={tabletIp}
              onChange={setTabletIp}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field
                label={t('tabletPortLabel')}
                name="port"
                placeholder="8080"
                value={tabletPort}
                onChange={setTabletPort}
              />
              <Field
                label={t('tabletUserLabel')}
                name="webUser"
                placeholder="admin"
                value={tabletUser}
                onChange={setTabletUser}
              />
              <Field
                label={t('tabletPassLabel')}
                name="webPass"
                placeholder="avyra"
                value={tabletPass}
                onChange={setTabletPass}
              />
            </div>
            {tabletState.error && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {tabletState.error}
              </p>
            )}
            <button
              type="submit"
              disabled={tabletPending || !tabletName || !tabletIp}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-40"
            >
              {tabletPending && <Loader2 className="size-4 animate-spin" />}
              {tabletPending ? tc('adding') : t('tabletAdd')}
            </button>
          </form>
        ) : (
          <>
        {/* ── Escáner automático ───────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('autoSearch')}</p>
              <p className="text-xs text-muted-foreground">{t('scanSubnet')}</p>
            </div>
            <button
              type="button"
              onClick={scan}
              disabled={scanning}
              className="flex items-center gap-2 rounded-md bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50 transition"
            >
              {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <Radio className="size-3.5" />}
              {scanning ? t('scanning') : t('searchCameras')}
            </button>
          </div>

          {scanning && (
            <p className="text-xs text-muted-foreground animate-pulse">
              {t('scanningProgress')}
            </p>
          )}
          {scanError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{scanError}</p>
          )}
          {discovered.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t('camerasFound', { count: discovered.length })}
              </p>
              {discovered.map((cam) => (
                <button
                  key={cam.ip}
                  type="button"
                  onClick={() => selectCamera(cam)}
                  className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                    selected === cam.ip
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background/50 hover:bg-accent/40'
                  }`}
                >
                  <div>
                    <span className="font-medium">{cam.name}</span>
                    {cam.model && <span className="ml-2 text-xs text-muted-foreground">({cam.model})</span>}
                    <span className="ml-2 text-xs text-muted-foreground">{cam.ip}</span>
                  </div>
                  {selected === cam.ip && <Check className="size-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Diagnóstico por IP manual */}
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">{t('checkIp')}</p>
            <p className="text-xs text-muted-foreground">
              {t('checkIpHint')}
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('ipPlaceholder')}
              value={probeIp}
              onChange={(e) => setProbeIp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && probe()}
              className="flex-1 rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 font-mono"
            />
            <button
              type="button"
              onClick={probe}
              disabled={probing || !probeIp}
              className="flex items-center gap-2 rounded-md bg-primary/15 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50 transition"
            >
              {probing ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              {t('probe')}
            </button>
          </div>

          {probeResult && (
            <div className="space-y-2">
              {/* Resumen */}
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                probeResult.snapshotFound
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : probeResult.reachable
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'bg-destructive/10 text-destructive'
              }`}>
                {probeResult.snapshotFound
                  ? <><Check className="size-4 shrink-0" /> {t('cameraFound')} <code className="text-xs">{probeResult.snapshotUrl}</code></>
                  : probeResult.reachable
                    ? <><Wifi className="size-4 shrink-0" /> {t('ipRespondsNoSnapshot')}</>
                    : <><WifiOff className="size-4 shrink-0" /> {t('noResponse', { ip: probeResult.ip })}</>
                }
              </div>

              {/* Detalle por path */}
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  {t('endpointDetail')}
                </summary>
                <div className="mt-2 space-y-1">
                  {(probeResult.results ?? []).map((r) => (
                    <div key={r.path} className="flex items-start gap-2 text-xs font-mono">
                      <span className={`shrink-0 w-16 text-right ${
                        r.isImage ? 'text-green-600 dark:text-green-400' :
                        r.status !== null ? 'text-muted-foreground' :
                        'text-destructive/60'
                      }`}>
                        {r.isImage ? t('imageOk') : r.status !== null ? `HTTP ${r.status}` : t('timeout')}
                      </span>
                      <span className="text-muted-foreground">{r.path}</span>
                      {r.contentType && <span className="text-muted-foreground/60">({r.contentType.split(';')[0]})</span>}
                      {r.error && !r.error.includes('timeout') && (
                        <span className="text-destructive/60">{r.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>

        {/* Formulario */}
        <form action={action} className="space-y-4">
          <input type="hidden" name="snapshotUrl" value={snapshotUrl} />
          <input type="hidden" name="rtspUrl" value={rtspUrl} />
          <input type="hidden" name="go2rtcStreamId" value={go2rtcStreamId} />

          <Field label={t('nameLabel')} name="name" placeholder={t('namePlaceholder')} value={name} onChange={setName} />
          <Field label={tc('model')} name="model" placeholder={t('modelPlaceholder')} value={model} onChange={setModel} />

          <div className="space-y-1.5">
            <label htmlFor="snapshotUrl-visible" className="block text-xs font-medium text-muted-foreground">
              {t('snapshotUrlLabel')} <span className="text-muted-foreground/60">({tc('optional')})</span>
            </label>
            <input
              id="snapshotUrl-visible"
              type="url"
              placeholder={t('snapshotUrlPlaceholder')}
              value={snapshotUrl}
              onChange={(e) => setSnapshotUrl(e.target.value)}
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
                <label htmlFor="rtspUrl-visible" className="block text-xs font-medium text-muted-foreground">{t('rtspUrlLabel')}</label>
                <input
                  id="rtspUrl-visible"
                  type="url"
                  placeholder={t('rtspUrlPlaceholder')}
                  value={rtspUrl}
                  onChange={(e) => setRtspUrl(e.target.value)}
                  className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="go2rtcStreamId-visible" className="block text-xs font-medium text-muted-foreground">{t('go2rtcLabel')}</label>
                <input
                  id="go2rtcStreamId-visible"
                  placeholder={t('go2rtcPlaceholder')}
                  value={go2rtcStreamId}
                  onChange={(e) => setGo2rtcStreamId(e.target.value)}
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
            disabled={pending || !snapshotUrl || !name}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-40"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? tc('adding') : t('addCamera')}
          </button>
        </form>
          </>
        )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  label, name, placeholder, value, onChange,
}: {
  label: string; name: string; placeholder?: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        id={name}
        name={name}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}

