import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, getActiveHouseholdRole } from '@/lib/household';
import { getEntityStates } from '@/lib/ha';
import { getDevicePushPrefs } from '@/lib/device-push';
import { getDb, devices, lights } from '@pradomotica/db';
import { AddLightButton } from './add-light-button';
import { PageHeader } from '../_components/page-header';
import { LightGrid } from './light-grid';

export async function generateMetadata() {
  const t = await getTranslations('lights');
  return { title: t('title') };
}

export default async function LightsPage() {
  const t = await getTranslations('lights');
  const session = await auth();
  if (!session?.user?.id) return null;

  const db = getDb();

  const householdId = await getActiveHouseholdId(session.user.id);

  const list = householdId
    ? await db
        .select({
          id: devices.id,
          name: devices.name,
          haEntityId: devices.haEntityId,
          model: lights.model,
        })
        .from(devices)
        .innerJoin(lights, eq(lights.deviceId, devices.id))
        .where(eq(devices.householdId, householdId))
        .orderBy(devices.createdAt)
    : [];

  const haEntityIds = list.map((l) => l.haEntityId).filter((id): id is string => !!id);
  const [haStates, pushPrefs] = await Promise.all([
    getEntityStates(haEntityIds),
    getDevicePushPrefs(session.user.id, list.map((l) => l.id), 'lights'),
  ]);

  const role = await getActiveHouseholdRole(session.user.id);
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="container py-10">
      <PageHeader
        title={t('title')}
        subtitle={list.length === 0 ? t('addFirst') : t('deviceCount', { count: list.length })}
        action={canManage ? <AddLightButton /> : undefined}
      />

      <LightGrid lights={list} haStates={haStates} pushPrefs={pushPrefs} canManage={canManage} />
    </div>
  );
}
