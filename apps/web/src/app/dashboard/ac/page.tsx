import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, getActiveHouseholdRole } from '@/lib/household';
import { getRawEntityState } from '@/lib/ha';
import { getDevicePushPrefs } from '@/lib/device-push';
import { getDb, devices, acUnits } from '@pradomotica/db';
import { AddAcButton } from './add-ac-button';
import { PageHeader } from '../_components/page-header';
import { AcGrid } from './ac-grid';

export async function generateMetadata() {
  const t = await getTranslations('ac');
  return { title: t('title') };
}

interface AcClimateState {
  state: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  fanMode: string | null;
  fanModes: string[];
}

async function getAcClimateStates(entityIds: string[]): Promise<Record<string, AcClimateState>> {
  if (entityIds.length === 0) return {};

  const results = await Promise.allSettled(
    entityIds.map(async (id) => {
      const raw = await getRawEntityState(id);
      if (!raw) return [id, null] as const;

      const attrs = raw.attributes ?? {};
      const current = typeof attrs.current_temperature === 'number' ? attrs.current_temperature : null;
      const target = typeof attrs.temperature === 'number' ? attrs.temperature : null;
      const fanMode = typeof attrs.fan_mode === 'string' ? attrs.fan_mode : null;
      const fanModes = Array.isArray(attrs.fan_modes)
        ? attrs.fan_modes.filter((m): m is string => typeof m === 'string')
        : [];

      const parsed: AcClimateState = {
        state: raw.state,
        currentTemperature: current,
        targetTemperature: target,
        fanMode,
        fanModes,
      };
      return [id, parsed] as const;
    }),
  );

  const out: Record<string, AcClimateState> = {};
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value[1] !== null) {
      out[result.value[0]] = result.value[1];
    }
  }
  return out;
}

export default async function AcPage() {
  const t = await getTranslations('ac');
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
          model: acUnits.model,
        })
        .from(devices)
        .innerJoin(acUnits, eq(acUnits.deviceId, devices.id))
        .where(eq(devices.householdId, householdId))
        .orderBy(devices.createdAt)
    : [];

  const haEntityIds = list
    .map((u) => u.haEntityId)
    .filter((id): id is string => !!id);
  const [climateStates, pushPrefs] = await Promise.all([
    getAcClimateStates(haEntityIds),
    getDevicePushPrefs(session.user.id, list.map((u) => u.id), 'ac'),
  ]);

  const role = await getActiveHouseholdRole(session.user.id);
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="container py-10">
      <PageHeader
        title={t('title')}
        subtitle={list.length === 0 ? t('addFirst') : t('unitCount', { count: list.length })}
        action={canManage ? <AddAcButton /> : undefined}
      />

      <AcGrid acUnits={list} climateStates={climateStates} pushPrefs={pushPrefs} canManage={canManage} />
    </div>
  );
}
