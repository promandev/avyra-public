import { eq } from 'drizzle-orm';
import { getNow, getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, getActiveHouseholdRole } from '@/lib/household';
import { getClimateEntityStates } from '@/lib/ha';
import { getDevicePushPrefs } from '@/lib/device-push';
import { getDb, devices, thermostats } from '@pradomotica/db';
import { AddThermostatButton } from './add-thermostat-button';
import { PageHeader } from '../_components/page-header';
import { ThermostatGrid } from './thermostat-grid';

export async function generateMetadata() {
  const t = await getTranslations('heating');
  return { title: t('title') };
}

export default async function HeatingPage() {
  const t = await getTranslations('heating');
  const session = await auth();
  if (!session?.user?.id) return null;

  const db = getDb();

  const householdId = await getActiveHouseholdId(session.user.id);

  let list: { id: string; name: string; haEntityId: string | null; model: string | null; temperatureScale: number }[] = [];

  if (householdId) {
    try {
      list = await db
        .select({
          id: devices.id,
          name: devices.name,
          haEntityId: devices.haEntityId,
          model: thermostats.model,
          temperatureScale: thermostats.temperatureScale,
        })
        .from(devices)
        .innerJoin(thermostats, eq(thermostats.deviceId, devices.id))
        .where(eq(devices.householdId, householdId))
        .orderBy(devices.createdAt);
    } catch (err) {
      // Fallback: query without temperatureScale (column may not exist if migration pending).
      console.error('[heating] Query error (temperatureScale may be missing):', err);
      const fallback = await db
        .select({
          id: devices.id,
          name: devices.name,
          haEntityId: devices.haEntityId,
        })
        .from(devices)
        .innerJoin(thermostats, eq(thermostats.deviceId, devices.id))
        .where(eq(devices.householdId, householdId))
        .orderBy(devices.createdAt);
      list = fallback.map((d) => ({ ...d, model: null, temperatureScale: 1 }));
    }
  }

  const haEntityIds = list
    .map((t) => t.haEntityId)
    .filter((id): id is string => !!id);
  const [climateStates, pushPrefs, now] = await Promise.all([
    getClimateEntityStates(haEntityIds),
    getDevicePushPrefs(session.user.id, list.map((d) => d.id), 'heating'),
    getNow(),
  ]);

  const role = await getActiveHouseholdRole(session.user.id);
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="container py-10">
      <PageHeader
        title={t('title')}
        subtitle={list.length === 0 ? t('addFirst') : t('deviceCount', { count: list.length })}
        action={canManage ? <AddThermostatButton /> : undefined}
      />

      <ThermostatGrid
        thermostats={list}
        climateStates={climateStates}
        now={now.getTime()}
        pushPrefs={pushPrefs}
        canManage={canManage}
      />
    </div>
  );
}
