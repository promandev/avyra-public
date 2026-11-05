import { Camera, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { ADMIN_EMAIL, TABLET_CAMERA_MODEL } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { getActiveHouseholdId } from '@/lib/household';
import { getDevicePushPrefs } from '@/lib/device-push';
import { isSuperAdmin } from '@/lib/super-admin';
import { eq } from 'drizzle-orm';
import { getDb, cameras, devices, tabletAgents } from '@pradomotica/db';
import { AddCameraButton } from './add-camera-button';
import { CameraGrid } from './camera-grid';

export default async function CamerasPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const isAdmin = session.user.email === ADMIN_EMAIL;
  // El enlace es cosmético: la página del registro tiene su propia puerta.
  const canViewLog = await isSuperAdmin(session.user.id);

  const t = await getTranslations('cameras');
  const db = getDb();

  const householdId = await getActiveHouseholdId(session.user.id);

  const rawList = householdId
    ? await db
        .select({
          id: devices.id,
          name: devices.name,
          model: cameras.model,
          snapshotUrlEnc: cameras.snapshotUrlEnc,
          rtspUrlEnc: cameras.rtspUrlEnc,
          go2rtcStreamId: cameras.go2rtcStreamId,
          tabletTokenHash: tabletAgents.tokenHash,
          tabletPairingSecretEnc: tabletAgents.pairingSecretEnc,
          tabletStatus: tabletAgents.status,
        })
        .from(devices)
        .innerJoin(cameras, eq(cameras.deviceId, devices.id))
        .leftJoin(tabletAgents, eq(tabletAgents.deviceId, devices.id))
        .where(eq(devices.householdId, householdId))
        .orderBy(devices.createdAt)
    : [];

  const cameraList = rawList
    .map((cam) => {
      let tabletPairingData: string | null = null;
      if (cam.model === TABLET_CAMERA_MODEL && cam.tabletPairingSecretEnc && !cam.tabletTokenHash) {
        try {
          const secret = decrypt(cam.tabletPairingSecretEnc);
          tabletPairingData = JSON.stringify({ deviceId: cam.id, secret });
        } catch {
          // ignore decrypt error
        }
      }
      return {
        id: cam.id,
        name: cam.name,
        model: cam.model,
        snapshotUrl: cam.snapshotUrlEnc ? decrypt(cam.snapshotUrlEnc) : null,
        rtspUrl: cam.rtspUrlEnc ? decrypt(cam.rtspUrlEnc) : null,
        go2rtcStreamId: cam.go2rtcStreamId,
        isTablet: cam.model === TABLET_CAMERA_MODEL,
        tabletPaired: !!cam.tabletTokenHash,
        tabletStatus: cam.tabletStatus ?? null,
        tabletPairingData,
      };
    });

  // Las tablets no avisan (la ruta de movimiento las ignora): sin interruptor.
  const pushPrefs = await getDevicePushPrefs(
    session.user.id,
    cameraList.filter((cam) => !cam.isTablet).map((cam) => cam.id),
    'cameras',
  );
  const regularCameras = cameraList
    .filter((cam) => !cam.isTablet)
    .map((cam) => ({ ...cam, pushOn: pushPrefs[cam.id] ?? true }));
  const tabletCameras = cameraList.filter((cam) => cam.isTablet);

  return (
    <div className="container py-10">
      {regularCameras.length === 0 && tabletCameras.length === 0 ? (
        <>
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-in-down">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
              <p className="text-sm text-muted-foreground">{t('addFirst')}</p>
            </div>
            <AddCameraButton isAdmin={isAdmin} />
          </header>
          <div className="glass flex flex-col items-center justify-center gap-3 rounded-2xl p-12 text-center animate-scale-in">
            <Camera className="size-10 text-primary" />
            <h2 className="text-xl font-medium">{t('noConnected')}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t.rich('addInstructions', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {t('snapshotUrlExample')}
              </code>
            </p>
          </div>
        </>
      ) : (
        <Suspense fallback={null}>
          <CameraGrid
            cameras={regularCameras}
            tabletCameras={isAdmin ? tabletCameras : []}
            isAdmin={isAdmin}
            addButton={
              <div className="flex items-center gap-2">
                {canViewLog && (
                  <Link
                    href="/dashboard/cameras/log"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition"
                  >
                    <ScrollText className="size-4" />
                    {t('diagLogLink')}
                  </Link>
                )}
                <AddCameraButton isAdmin={isAdmin} />
              </div>
            }
          />
        </Suspense>
      )}
    </div>
  );
}

