import 'server-only';

import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';

import { getDb, devices, litterBoxes, litterCats, litterVisits } from '@pradomotica/db';
import {
  classifyVisit,
  isLitterVisitKind,
  nearestCat,
  summarizeVisits,
  type LitterCatInfo,
  type LitterDayData,
  type LitterVisitKind,
} from './litter';
import { madridDayBounds } from './madrid-time';

/** Lecturas y recálculos del arenero que comparten la página, las acciones y el sondeo. */

export async function getHouseholdCats(householdId: string): Promise<LitterCatInfo[]> {
  return getDb()
    .select({ id: litterCats.id, name: litterCats.name, referenceWeightKg: litterCats.referenceWeightKg })
    .from(litterCats)
    .where(eq(litterCats.householdId, householdId))
    .orderBy(asc(litterCats.createdAt));
}

/** Visitas y resumen por gato de un día de Madrid. No comprueba permisos. */
export async function loadLitterDay(
  deviceId: string,
  householdId: string,
  day: string,
): Promise<LitterDayData> {
  const { start, end } = madridDayBounds(day);
  const [rows, cats] = await Promise.all([
    getDb()
      .select()
      .from(litterVisits)
      .where(
        and(
          eq(litterVisits.deviceId, deviceId),
          gte(litterVisits.occurredAt, start),
          lt(litterVisits.occurredAt, end),
        ),
      )
      .orderBy(asc(litterVisits.occurredAt)),
    getHouseholdCats(householdId),
  ]);

  const visits = rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    weightKg: r.weightKg,
    durationS: r.durationS,
    catId: r.catId,
    catManual: r.catManual,
    kind: (isLitterVisitKind(r.kind) ? r.kind : 'unknown') as LitterVisitKind,
    kindManual: r.kindManual,
  }));
  return { date: day, visits, summary: summarizeVisits(visits, cats) };
}

/** Agrupa ids por valor nuevo: una UPDATE por gato o por tipo, no una por fila. */
function groupBy<T extends string | null>(items: { id: string; next: T }[]): Map<T, string[]> {
  const out = new Map<T, string[]>();
  for (const item of items) {
    const list = out.get(item.next) ?? [];
    list.push(item.id);
    out.set(item.next, list);
  }
  return out;
}

/**
 * Vuelve a elegir gato en las visitas que nadie ha corregido a mano. Se llama al
 * cambiar los gatos o sus pesos de referencia.
 */
export async function reassignCats(householdId: string): Promise<void> {
  const db = getDb();
  const cats = await getHouseholdCats(householdId);
  const rows = await db
    .select({ id: litterVisits.id, weightKg: litterVisits.weightKg, catId: litterVisits.catId })
    .from(litterVisits)
    .innerJoin(devices, eq(devices.id, litterVisits.deviceId))
    .where(and(eq(devices.householdId, householdId), eq(litterVisits.catManual, false)));

  const changed = rows
    .map((r) => ({ id: r.id, current: r.catId, next: nearestCat(r.weightKg, cats) }))
    .filter((r) => r.next !== r.current);
  for (const [catId, ids] of groupBy(changed)) {
    await db.update(litterVisits).set({ catId }).where(inArray(litterVisits.id, ids));
  }
}

/** Recalcula pis/caca de las visitas no corregidas tras cambiar el umbral. */
export async function reclassifyVisits(deviceId: string): Promise<void> {
  const db = getDb();
  const [box] = await db
    .select({ poopMinSeconds: litterBoxes.poopMinSeconds })
    .from(litterBoxes)
    .where(eq(litterBoxes.deviceId, deviceId))
    .limit(1);
  if (!box) return;

  const rows = await db
    .select({ id: litterVisits.id, durationS: litterVisits.durationS, kind: litterVisits.kind })
    .from(litterVisits)
    .where(and(eq(litterVisits.deviceId, deviceId), eq(litterVisits.kindManual, false)));

  const changed = rows
    .map((r) => ({ id: r.id, current: r.kind, next: classifyVisit(r.durationS, box.poopMinSeconds) }))
    .filter((r) => r.next !== r.current);
  for (const [kind, ids] of groupBy(changed)) {
    await db.update(litterVisits).set({ kind }).where(inArray(litterVisits.id, ids));
  }
}
