import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, getActiveHouseholdRole } from '@/lib/household';
import { getRawEntityState } from '@/lib/ha';
import { getDevicePushPrefs } from '@/lib/device-push';
import { parseWaterTank, readFanSpeedList, type VacuumLiveState } from '@/lib/vacuum';
import { getDb, devices, vacuums } from '@pradomotica/db';
import { PageHeader } from '../_components/page-header';
import { AddVacuumButton } from './add-vacuum-button';
import { VacuumGrid, type VacuumUnit } from './vacuum-grid';

export async function generateMetadata() {
  const t = await getTranslations('vacuum');
  return { title: t('title') };
}

function numericState(state: string | undefined): number | null {
  if (state === undefined || state.trim() === '') return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

/** Estado vivo por dispositivo (no por entidad: cada robot combina hasta tres). */
async function getVacuumLiveStates(units: VacuumUnit[]): Promise<Record<string, VacuumLiveState>> {
  const results = await Promise.allSettled(
    units
      .filter((u) => !!u.haEntityId)
      .map(async (u) => {
        const [main, tank, battery] = await Promise.all([
          getRawEntityState(u.haEntityId!),
          u.waterTankEntityId ? getRawEntityState(u.waterTankEntityId) : null,
          u.batteryEntityId ? getRawEntityState(u.batteryEntityId) : null,
        ]);
        if (!main) return null;

        const attrs = main.attributes ?? {};
        // tuya-local publica la batería como sensor aparte; otras integraciones
        // aún la dejan como atributo de la entidad vacuum.
        const batteryLevel =
          numericState(battery?.state) ??
          (typeof attrs.battery_level === 'number' ? attrs.battery_level : null);

        const live: VacuumLiveState = {
          state: main.state,
          fanSpeed: typeof attrs.fan_speed === 'string' ? attrs.fan_speed : null,
          fanSpeedList: readFanSpeedList(attrs),
          battery: batteryLevel === null ? null : Math.round(batteryLevel),
          waterTank: u.waterTankEntityId
            ? parseWaterTank(u.waterTankEntityId, tank?.state ?? 'unavailable', tank?.attributes ?? {})
            : null,
        };
        return [u.id, live] as const;
      }),
  );

  const out: Record<string, VacuumLiveState> = {};
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) out[result.value[0]] = result.value[1];
  }
  return out;
}

export default async function VacuumPage() {
  const t = await getTranslations('vacuum');
  const session = await auth();
  if (!session?.user?.id) return null;

  const householdId = await getActiveHouseholdId(session.user.id);

  const list: VacuumUnit[] = householdId
    ? await getDb()
        .select({
          id: devices.id,
          name: devices.name,
          haEntityId: devices.haEntityId,
          model: vacuums.model,
          waterTankEntityId: vacuums.waterTankEntityId,
          batteryEntityId: vacuums.batteryEntityId,
          cleanTimeEntityId: vacuums.cleanTimeEntityId,
          cleanAreaEntityId: vacuums.cleanAreaEntityId,
        })
        .from(devices)
        .innerJoin(vacuums, eq(vacuums.deviceId, devices.id))
        .where(eq(devices.householdId, householdId))
        .orderBy(devices.createdAt)
    : [];

  const [liveStates, pushPrefs] = await Promise.all([
    getVacuumLiveStates(list),
    getDevicePushPrefs(session.user.id, list.map((v) => v.id), 'vacuum'),
  ]);

  const role = await getActiveHouseholdRole(session.user.id);
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="container py-10">
      <PageHeader
        title={t('title')}
        subtitle={list.length === 0 ? t('addFirst') : t('unitCount', { count: list.length })}
        action={canManage ? <AddVacuumButton /> : undefined}
      />

      <VacuumGrid vacuums={list} liveStates={liveStates} pushPrefs={pushPrefs} canManage={canManage} />
    </div>
  );
}
