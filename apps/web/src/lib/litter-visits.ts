import 'server-only';

import { and, eq, gte, isNull, lt, or } from 'drizzle-orm';

import { getDb, devices, litterBoxes, litterVisits } from '@pradomotica/db';
import { getHaHistory, getRawEntityState } from './ha';
import { newId } from './id';
import {
  availabilityEntity,
  classifyVisit,
  extractVisits,
  humanizeValue,
  nearestCat,
  summarizeVisits,
  toKg,
  VISIT_MATCH_WINDOW_MS,
  type LitterCatSummary,
  type LitterDurationMode,
} from './litter';
import { getHouseholdCats } from './litter-data';
import { addDays, madridDate, madridDayBounds, madridHour } from './madrid-time';
import { sendPushToHousehold } from './push';

/**
 * Sondeo del arenero: registra visitas, avisa de fallos y manda el resumen de
 * la víspera a las 10:00.
 *
 * Las visitas se reconstruyen del historial de HA y no de lecturas sueltas: la
 * app se reinicia en cada despliegue, y con un cursor sobre el historial (HA
 * guarda 10 días) lo que pase mientras tanto se recupera al volver.
 *
 * Los avisos de fallo se recuerdan en la base de datos y no en memoria, así que
 * un reinicio ni los repite ni se come uno que empezó durante el corte.
 */

/** Lo reciente se deja reposar: peso y duración pueden llegar tras el contador. */
const SETTLE_MS = VISIT_MATCH_WINDOW_MS + 30_000;
/** Al dar de alta el arenero se importa lo que aún guarde HA. */
const BACKFILL_MS = 10 * 24 * 60 * 60_000;
const RETENTION_MS = 365 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
/** Un corte de WiFi corto no es un fallo; media hora sin conexión, sí. */
const OFFLINE_ALERT_MS = 30 * 60_000;
const SUMMARY_HOUR = 10;
/** Valores de la entidad de estado que significan un problema. */
const ERROR_STATUS = /fault|error|abnormal|stuck|jam/i;

let lastPruneAt = 0;

async function loadBoxes() {
  return getDb()
    .select({
      id: devices.id,
      name: devices.name,
      householdId: devices.householdId,
      createdAt: devices.createdAt,
      statusEntityId: devices.haEntityId,
      weightEntityId: litterBoxes.weightEntityId,
      visitsEntityId: litterBoxes.visitsEntityId,
      durationEntityId: litterBoxes.durationEntityId,
      durationMode: litterBoxes.durationMode,
      faultEntityIds: litterBoxes.faultEntityIds,
      poopMinSeconds: litterBoxes.poopMinSeconds,
      historyCursor: litterBoxes.historyCursor,
      lastSummaryDate: litterBoxes.lastSummaryDate,
      alertState: litterBoxes.alertState,
    })
    .from(devices)
    .innerJoin(litterBoxes, eq(litterBoxes.deviceId, devices.id));
}

type Box = Awaited<ReturnType<typeof loadBoxes>>[number];

export async function runLitterTick(now = new Date()): Promise<{ recorded: number }> {
  const boxes = await loadBoxes();
  let recorded = 0;

  for (const box of boxes) {
    // Cada parte por separado: un historial que no responde no debe tapar un
    // aviso de fallo ni el resumen.
    try {
      recorded += await recordVisits(box, now);
    } catch (err) {
      console.error(`[litter] Visits failed for ${box.id}:`, err instanceof Error ? err.message : err);
    }
    try {
      await checkFaults(box, now);
    } catch (err) {
      console.error(`[litter] Faults failed for ${box.id}:`, err instanceof Error ? err.message : err);
    }
    try {
      await sendDailySummary(box, now);
    } catch (err) {
      console.error(`[litter] Summary failed for ${box.id}:`, err instanceof Error ? err.message : err);
    }
  }

  if (now.getTime() - lastPruneAt > PRUNE_EVERY_MS) {
    lastPruneAt = now.getTime();
    await getDb()
      .delete(litterVisits)
      .where(lt(litterVisits.occurredAt, new Date(now.getTime() - RETENTION_MS)));
  }

  return { recorded };
}

// ---------- Visitas -------------------------------------------------------------

async function recordVisits(box: Box, now: Date): Promise<number> {
  const trigger = box.visitsEntityId ?? box.weightEntityId;
  if (!trigger) return 0;

  const until = new Date(now.getTime() - SETTLE_MS);
  const after = box.historyCursor ?? new Date(now.getTime() - BACKFILL_MS);
  if (until <= after) return 0;

  const ids = [box.visitsEntityId, box.weightEntityId, box.durationEntityId].filter(
    (id): id is string => !!id,
  );
  // Desde antes del cursor: el peso de una visita puede haberse publicado justo
  // antes de que subiera el contador.
  const history = await getHaHistory(
    [...new Set(ids)],
    new Date(after.getTime() - VISIT_MATCH_WINDOW_MS),
    now,
  );
  // Sin respuesta de HA el cursor no se mueve y se reintenta en la próxima pasada.
  if (!history) return 0;

  const series = (id: string | null) => (id ? (history[id] ?? []) : undefined);
  const found = extractVisits(
    {
      counter: series(box.visitsEntityId),
      weight: series(box.weightEntityId),
      duration: series(box.durationEntityId),
      durationMode: box.durationMode as LitterDurationMode,
    },
    after,
    until,
  );

  const db = getDb();
  let inserted = 0;
  if (found.length > 0) {
    const [weightState, cats] = await Promise.all([
      box.weightEntityId ? getRawEntityState(box.weightEntityId) : null,
      getHouseholdCats(box.householdId),
    ]);
    const unit = weightState?.attributes?.unit_of_measurement;

    const rows = found.map((visit) => {
      const weightKg = visit.weight === null ? null : toKg(visit.weight, unit);
      return {
        id: newId(),
        deviceId: box.id,
        occurredAt: visit.at,
        weightKg,
        durationS: visit.durationS,
        catId: nearestCat(weightKg, cats),
        kind: classifyVisit(visit.durationS, box.poopMinSeconds),
      };
    });
    // El tramo se relee con solape: lo que ya estaba no entra dos veces.
    const result = await db
      .insert(litterVisits)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: litterVisits.id });
    inserted = result.length;
  }

  await db.update(litterBoxes).set({ historyCursor: until }).where(eq(litterBoxes.deviceId, box.id));
  box.historyCursor = until;
  return inserted;
}

// ---------- Fallos --------------------------------------------------------------

const unusable = (state: string) => state === 'unavailable' || state === 'unknown';

async function checkFaults(box: Box, now: Date): Promise<void> {
  const availabilityId = availabilityEntity({
    haEntityId: box.statusEntityId,
    visitsEntityId: box.visitsEntityId,
    weightEntityId: box.weightEntityId,
  });
  const main = availabilityId ? await getRawEntityState(availabilityId) : null;
  // Sin respuesta de HA no hay nada fiable que comparar.
  if (availabilityId && !main) return;

  const previous = box.alertState?.active ?? null;
  /** Fallo activo → texto del aviso. */
  const active = new Map<string, string>();
  // Sin lectura se conserva lo que había: un corte no es "se arregló", y al
  // volver no debe repetirse el aviso.
  const keep = (key: string) => {
    if (previous?.includes(key)) active.set(key, '');
  };

  if (main) {
    if (main.state === 'unavailable') {
      const since = main.last_changed ? Date.parse(main.last_changed) : Number.NaN;
      if (Number.isFinite(since) && now.getTime() - since >= OFFLINE_ALERT_MS) {
        active.set('offline', 'Lleva más de 30 min sin conexión.');
      }
    }
    // Sólo la entidad de estado dice qué le pasa; un sensor de peso no.
    if (box.statusEntityId) {
      if (unusable(main.state)) {
        for (const key of previous ?? []) if (key.startsWith('status:')) keep(key);
      } else if (ERROR_STATUS.test(main.state)) {
        active.set(`status:${main.state}`, humanizeValue(main.state));
      }
    }
  }

  for (const entityId of box.faultEntityIds) {
    const raw = await getRawEntityState(entityId);
    if (!raw || unusable(raw.state)) {
      keep(entityId);
      continue;
    }
    if (raw.state === 'on') {
      const name = raw.attributes?.friendly_name;
      active.set(entityId, typeof name === 'string' ? name : humanizeValue(entityId.split('.')[1] ?? entityId));
    }
  }

  const keys = [...active.keys()].sort();
  // Sin estado guardado es la primera pasada tras el alta: sólo se toma la foto.
  const fresh = previous === null ? [] : keys.filter((key) => !previous.includes(key));

  if (previous === null || keys.join('\n') !== [...previous].sort().join('\n')) {
    await getDb()
      .update(litterBoxes)
      .set({ alertState: { active: keys } })
      .where(eq(litterBoxes.deviceId, box.id));
  }

  const lines = fresh.map((key) => active.get(key)).filter((line): line is string => !!line);
  if (lines.length === 0) return;
  await sendPushToHousehold(
    box.householdId,
    {
      title: `⚠️ ${box.name}`,
      body: lines.join(' · '),
      url: '/dashboard/litter',
      tag: `litter:${box.id}`,
    },
    'litter',
    box.id,
  );
}

// ---------- Resumen diario ------------------------------------------------------

function summaryText(summary: LitterCatSummary[], hasCats: boolean): string {
  const total = summary.reduce((n, row) => n + row.visits, 0);
  if (total === 0) return '⚠️ Nadie usó el arenero ayer.';
  if (!hasCats) return `${total} ${total === 1 ? 'visita' : 'visitas'}.`;

  return summary
    .map((row) => {
      const name = row.name ?? 'Sin identificar';
      if (row.visits === 0) return `⚠️ ${name} no fue`;
      const kinds = [
        row.pee > 0 ? `${row.pee} pis` : null,
        row.poop > 0 ? `${row.poop} ${row.poop === 1 ? 'caca' : 'cacas'}` : null,
      ].filter(Boolean);
      return `${name} ${row.visits} ${row.visits === 1 ? 'vez' : 'veces'}${kinds.length > 0 ? ` (${kinds.join(', ')})` : ''}`;
    })
    .join(' · ');
}

async function sendDailySummary(box: Box, now: Date): Promise<void> {
  if (madridHour(now) < SUMMARY_HOUR) return;
  const today = madridDate(now);
  if (box.lastSummaryDate !== null && box.lastSummaryDate >= today) return;

  const yesterday = addDays(today, -1);
  const { start, end } = madridDayBounds(yesterday);
  // Hasta que el registro no haya leído el día entero, al resumen le faltarían
  // visitas. Si HA estuvo caído, espera a que se ponga al día.
  if (!box.historyCursor || box.historyCursor < end) return;

  const db = getDb();
  // Se reclama el día de forma atómica: con dos pasadas o tras un reinicio, el
  // resumen sale una sola vez. Si la app estaba parada a las 10:00, sale al volver.
  const claimed = await db
    .update(litterBoxes)
    .set({ lastSummaryDate: today })
    .where(
      and(
        eq(litterBoxes.deviceId, box.id),
        or(isNull(litterBoxes.lastSummaryDate), lt(litterBoxes.lastSummaryDate, today)),
      ),
    )
    .returning({ id: litterBoxes.deviceId });
  if (claimed.length === 0) return;
  box.lastSummaryDate = today;

  const [visits, cats] = await Promise.all([
    db
      .select({
        occurredAt: litterVisits.occurredAt,
        catId: litterVisits.catId,
        kind: litterVisits.kind,
        durationS: litterVisits.durationS,
        weightKg: litterVisits.weightKg,
      })
      .from(litterVisits)
      .where(
        and(
          eq(litterVisits.deviceId, box.id),
          gte(litterVisits.occurredAt, start),
          lt(litterVisits.occurredAt, end),
        ),
      ),
    getHouseholdCats(box.householdId),
  ]);
  // Dado de alta ayer y sin nada importado: no hay un día que resumir.
  if (visits.length === 0 && box.createdAt > start) return;

  await sendPushToHousehold(
    box.householdId,
    {
      title: `🐱 ${box.name}: resumen de ayer`,
      body: summaryText(summarizeVisits(visits, cats), cats.length > 0),
      url: '/dashboard/litter',
      tag: `litter-summary:${box.id}`,
    },
    'litter',
    box.id,
  );
}
