import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, getActiveHouseholdRole } from '@/lib/household';
import { getRawEntityState } from '@/lib/ha';
import { getDevicePushPrefs } from '@/lib/device-push';
import {
  availabilityEntity,
  humanizeValue,
  readNumberSetting,
  type LitterDayData,
  type LitterLiveState,
} from '@/lib/litter';
import { getHouseholdCats, loadLitterDay } from '@/lib/litter-data';
import { madridDate } from '@/lib/madrid-time';
import { getDb, devices, litterBoxes } from '@pradomotica/db';
import { PageHeader } from '../_components/page-header';
import { LitterHeaderActions } from './header-actions';
import { LitterGrid, type LitterUnit } from './litter-grid';

export async function generateMetadata() {
  const t = await getTranslations('litter');
  return { title: t('title') };
}

/**
 * Estado vivo: estado, conexión, limpieza automática y su retraso, y los
 * sensores de fallo que estén en `on`.
 */
async function getLitterLiveStates(units: LitterUnit[]): Promise<Record<string, LitterLiveState>> {
  const results = await Promise.allSettled(
    units.map(async (u) => {
      const availabilityId = availabilityEntity(u);
      const [main, autoClean, cleanDelay, ...faults] = await Promise.all([
        availabilityId ? getRawEntityState(availabilityId) : null,
        u.autoCleanEntityId ? getRawEntityState(u.autoCleanEntityId) : null,
        u.cleanDelayEntityId ? getRawEntityState(u.cleanDelayEntityId) : null,
        ...u.faultEntityIds.map((id) => getRawEntityState(id)),
      ]);
      const live: LitterLiveState = {
        // El estado sólo lo da la entidad de estado; si se usa un sensor para
        // saber si está conectado, su número no es un estado.
        state: u.haEntityId ? (main?.state ?? null) : null,
        autoClean: autoClean?.state === 'on' ? true : autoClean?.state === 'off' ? false : null,
        cleanDelay: readNumberSetting(cleanDelay?.state, cleanDelay?.attributes),
        faults: faults
          .map((raw, i) => {
            if (raw?.state !== 'on') return null;
            const name = raw.attributes?.friendly_name;
            return typeof name === 'string' ? name : humanizeValue(u.faultEntityIds[i]!.split('.')[1] ?? '');
          })
          .filter((label): label is string => !!label),
        offline: main?.state === 'unavailable',
      };
      return [u.id, live] as const;
    }),
  );

  const out: Record<string, LitterLiveState> = {};
  for (const result of results) {
    if (result.status === 'fulfilled') out[result.value[0]] = result.value[1];
  }
  return out;
}

export default async function LitterPage() {
  const t = await getTranslations('litter');
  const session = await auth();
  if (!session?.user?.id) return null;

  const householdId = await getActiveHouseholdId(session.user.id);

  const list: LitterUnit[] = householdId
    ? await getDb()
        .select({
          id: devices.id,
          name: devices.name,
          haEntityId: devices.haEntityId,
          model: litterBoxes.model,
          cleanEntityId: litterBoxes.cleanEntityId,
          emptyEntityId: litterBoxes.emptyEntityId,
          resetEntityId: litterBoxes.resetEntityId,
          autoCleanEntityId: litterBoxes.autoCleanEntityId,
          cleanDelayEntityId: litterBoxes.cleanDelayEntityId,
          weightEntityId: litterBoxes.weightEntityId,
          visitsEntityId: litterBoxes.visitsEntityId,
          durationEntityId: litterBoxes.durationEntityId,
          durationMode: litterBoxes.durationMode,
          faultEntityIds: litterBoxes.faultEntityIds,
          poopMinSeconds: litterBoxes.poopMinSeconds,
        })
        .from(devices)
        .innerJoin(litterBoxes, eq(litterBoxes.deviceId, devices.id))
        .where(eq(devices.householdId, householdId))
        .orderBy(devices.createdAt)
    : [];

  const today = madridDate();
  const [liveStates, pushPrefs, cats, days] = await Promise.all([
    getLitterLiveStates(list),
    getDevicePushPrefs(session.user.id, list.map((u) => u.id), 'litter'),
    householdId ? getHouseholdCats(householdId) : [],
    Promise.all(list.map((u) => loadLitterDay(u.id, householdId!, today))),
  ]);
  const initialDays: Record<string, LitterDayData> = Object.fromEntries(
    list.map((u, i) => [u.id, days[i]!]),
  );

  const role = await getActiveHouseholdRole(session.user.id);
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="container py-10">
      <PageHeader
        title={t('title')}
        subtitle={list.length === 0 ? t('addFirst') : t('unitCount', { count: list.length })}
        action={canManage ? <LitterHeaderActions cats={cats} /> : undefined}
      />

      <LitterGrid
        units={list}
        liveStates={liveStates}
        pushPrefs={pushPrefs}
        cats={cats}
        today={today}
        initialDays={initialDays}
        canManage={canManage}
      />
    </div>
  );
}
