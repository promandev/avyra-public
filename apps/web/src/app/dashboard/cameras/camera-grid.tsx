'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Trash2, Expand, Pencil, Lock, Loader2, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CameraFeed } from './camera-feed';
import { CameraModal } from './camera-modal';
import { EditCameraDialog, type EditableCameraData } from './edit-camera-dialog';
import { deleteCamera, verifyTabletAccess } from './actions';
import { DevicePushToggle } from '../_components/device-push-toggle';

interface Camera {
  id: string;
  name: string;
  model: string | null;
  snapshotUrl: string | null;
  rtspUrl: string | null;
  go2rtcStreamId: string | null;
  isTablet?: boolean;
  tabletPaired?: boolean;
  tabletStatus?: string | null;
  tabletPairingData?: string | null;
  /** Avisos push de esta cámara para el usuario actual. */
  pushOn?: boolean;
}

// ── Diálogo de acceso para cámara especial ───────────────────────────────────

type TabletAction = 'open' | 'edit' | 'delete';

interface TabletAccessDialogProps {
  cameraName: string;
  onVerified: () => void;
  onClose: () => void;
  pendingAction: TabletAction;
}

function TabletAccessDialog({ cameraName, onVerified, onClose, pendingAction }: TabletAccessDialogProps) {
  const t = useTranslations('cameras');
  const tc = useTranslations('common');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await verifyTabletAccess(username, password);
    setLoading(false);
    if (result.ok) {
      onVerified();
    } else {
      setError(t('tabletAccessDenied'));
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-t-2xl rounded-b-none md:rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto animate-sheet-up md:animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden mx-auto -mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden />
        <div className="flex items-center gap-3">
          <ShieldAlert className="size-5 text-primary shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">{t('tabletAccessTitle')}</h3>
            <p className="text-xs text-muted-foreground">{cameraName}</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="text"
            placeholder={t('tabletAccessUser')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              placeholder={t('tabletAccessPassword')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="w-full rounded-md border border-border bg-background/50 px-3 py-2 pr-9 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition"
            >
              {tc('cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40 transition hover:opacity-90"
            >
              {loading && <Loader2 className="size-3.5 animate-spin" />}
              {t('tabletAccessConfirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Grid principal ────────────────────────────────────────────────────────────

export function CameraGrid({ cameras, tabletCameras = [], isAdmin, addButton }: { cameras: Camera[]; tabletCameras?: Camera[]; isAdmin?: boolean; addButton?: React.ReactNode }) {
  const [expanded, setExpanded] = useState<Camera | null>(null);
  const [editing, setEditing] = useState<EditableCameraData | null>(null);
  const [showTablets, setShowTablets] = useState(false);
  const [initialTimestamp, setInitialTimestamp] = useState<string | null>(null);
  const t = useTranslations('cameras');
  const searchParams = useSearchParams();

  // Abrir modal automáticamente al llegar desde una notificación push
  useEffect(() => {
    const cameraId = searchParams.get('camera');
    const timestamp = searchParams.get('t');
    if (!cameraId) return;
    const allCams = [...cameras, ...tabletCameras];
    const cam = allCams.find((c) => c.id === cameraId);
    if (cam) {
      setExpanded(cam);
      if (timestamp) setInitialTimestamp(timestamp);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gesto secreto: 5 toques sobre el título "Cámaras" en menos de 3 s alternan
  // la visibilidad de la cámara de la tablet. Sólo funciona para el super admin
  // y sólo si hay alguna; ocultarla es cosmético, el acceso real lo comprueba
  // `verifyCameraAccess` en el servidor.
  const TAP_WINDOW_MS = 3000;
  const TAPS_REQUIRED = 5;
  const tapTimestamps = useRef<number[]>([]);
  const handleTitleTap = useCallback(() => {
    if (!isAdmin || tabletCameras.length === 0) return;
    const now = Date.now();
    tapTimestamps.current = [...tapTimestamps.current.filter((ts) => now - ts < TAP_WINDOW_MS), now];
    if (tapTimestamps.current.length >= TAPS_REQUIRED) {
      tapTimestamps.current = [];
      setShowTablets((prev) => !prev);
    }
  }, [isAdmin, tabletCameras.length]);

  // Tablet access gate
  const [tabletGate, setTabletGate] = useState<{ cam: Camera; action: TabletAction } | null>(null);

  const close = useCallback(() => { setExpanded(null); setInitialTimestamp(null); }, []);
  const closeEdit = useCallback(() => setEditing(null), []);

  const handleCameraAction = (cam: Camera, action: TabletAction) => {
    if (cam.isTablet && !isAdmin) {
      setTabletGate({ cam, action });
    } else {
      executeAction(cam, action);
    }
  };

  const executeAction = (cam: Camera, action: TabletAction) => {
    if (action === 'open') setExpanded(cam);
    if (action === 'edit') setEditing(cam);
    if (action === 'delete') {
      if (!confirm(t('deleteCamera') + '?')) return;
      deleteCamera(cam.id);
    }
  };

  const visibleCameras = showTablets ? [...cameras, ...tabletCameras] : cameras;

  return (
    <>
      {/* Header with 5-tap Easter egg on title */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-in-down">
        <div>
          <h1
            className="text-3xl font-semibold tracking-tight select-none"
            onClick={handleTitleTap}
          >
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('connectedCount', { count: cameras.length })}
          </p>
        </div>
        {addButton}
      </header>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 stagger">
        {visibleCameras.map((cam) => (
          <div
            key={cam.id}
            className={[
              'rounded-2xl overflow-hidden group relative transition-all duration-300 hover:-translate-y-1 hover:shadow-lg',
              cam.isTablet
                ? 'border-2 border-dashed border-primary/40 bg-primary/5 hover:shadow-primary/10'
                : 'glass hover:shadow-black/20',
            ].join(' ')}
          >
            {/* Tablet badge */}
            {cam.isTablet && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-primary/20 border border-primary/30 px-2 py-0.5 text-[10px] font-medium text-primary backdrop-blur-sm">
                <Lock className="size-3" />
                Test
              </div>
            )}

            {/* Thumbnail clickable */}
            <button
              type="button"
              className="relative block w-full"
              onClick={() => handleCameraAction(cam, 'open')}
              aria-label={t('expand', { name: cam.name })}
            >
              <CameraFeed cameraId={cam.id} refreshMs={5000} />
              {/* Hover overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-white backdrop-blur-sm">
                  {cam.isTablet ? <Lock className="size-4" /> : <Expand className="size-4" />}
                  <span className="text-sm font-medium">{t('viewLive')}</span>
                </div>
              </div>
            </button>

            {/* Info + acciones */}
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                className="text-left"
                onClick={() => handleCameraAction(cam, 'open')}
              >
                <p className="font-medium text-sm">{cam.name}</p>
                {cam.model && !cam.isTablet && (
                  <p className="text-xs text-muted-foreground">{cam.model}</p>
                )}
              </button>
              <div className="flex items-center gap-1">
                {!cam.isTablet && <DevicePushToggle deviceId={cam.id} initial={cam.pushOn ?? true} />}
                <button
                  type="button"
                  onClick={() => handleCameraAction(cam, 'edit')}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
                  title={t('editCamera')}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCameraAction(cam, 'delete')}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                  title={t('deleteCamera')}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {expanded && (
        <CameraModal
          cameraId={expanded.id}
          cameraName={expanded.name}
          isTablet={expanded.isTablet}
          tabletPaired={expanded.tabletPaired}
          tabletStatus={expanded.tabletStatus}
          tabletPairingData={expanded.tabletPairingData}
          initialTimestamp={initialTimestamp}
          onClose={close}
        />
      )}

      {editing && (
        <EditCameraDialog camera={editing} onClose={closeEdit} />
      )}

      {tabletGate && (
        <TabletAccessDialog
          cameraName={tabletGate.cam.name}
          pendingAction={tabletGate.action}
          onVerified={() => {
            const { cam, action } = tabletGate;
            setTabletGate(null);
            executeAction(cam, action);
          }}
          onClose={() => setTabletGate(null)}
        />
      )}
    </>
  );
}
