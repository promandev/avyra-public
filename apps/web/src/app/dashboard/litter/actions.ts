'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId, requireRole } from '@/lib/household';
import { callHaService, getRawEntityState } from '@/lib/ha';
import { newId } from '@/lib/id';
import {
  LITTER_ACTION_DOMAINS,
  LITTER_COMMANDS,
  LITTER_DURATION_MODES,
  LITTER_NUMBER_DOMAINS,
  LITTER_TOGGLE_DOMAINS,
  clampToSetting,
  classifyVisit,
  isLitterVisitKind,
  nearestCat,
  readNumberSetting,
  type LitterCommand,
  type LitterVisitKind,
} from '@/lib/litter';
import { getHouseholdCats, reassignCats, reclassifyVisits } from '@/lib/litter-data';
import { getDb, devices, litterBoxes, litterCats, litterVisits } from '@pradomotica/db';

const PATH = '/dashboard/litter';
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- Alta, edición y borrado ------------------------------------------

export type LitterFormState = { error?: string; success?: boolean };

async function parseLitterForm(formData: FormData) {
  const tc = await getTranslations('common');
  const tl = await getTranslations('litter');

  const entity = z.string().trim().max(200).regex(ENTITY_ID, tl('invalidEntity')).optional();
  const actionEntity = entity.refine(
    (v) => !v || LITTER_ACTION_DOMAINS.some((domain) => v.startsWith(`${domain}.`)),
    tl('invalidActionEntity'),
  );

  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    model: z.string().trim().max(80).optional(),
    haEntityId: entity,
    cleanEntityId: actionEntity,
    emptyEntityId: actionEntity,
    resetEntityId: actionEntity,
    autoCleanEntityId: entity.refine(
      (v) => !v || LITTER_TOGGLE_DOMAINS.some((domain) => v.startsWith(`${domain}.`)),
      tl('invalidToggleEntity'),
    ),
    cleanDelayEntityId: entity.refine(
      (v) => !v || LITTER_NUMBER_DOMAINS.some((domain) => v.startsWith(`${domain}.`)),
      tl('invalidNumberEntity'),
    ),
    weightEntityId: entity,
    visitsEntityId: entity,
    durationEntityId: entity,
    durationMode: z.enum(LITTER_DURATION_MODES),
    faultEntityIds: z.array(z.string().regex(ENTITY_ID, tl('invalidEntity'))).max(10),
    poopMinSeconds: z.coerce.number().int().min(10).max(1800),
  });

  const field = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };
  const faults = field('faultEntityIds') ?? '';

  const parsed = schema.safeParse({
    name: formData.get('name'),
    model: field('model'),
    haEntityId: field('haEntityId'),
    cleanEntityId: field('cleanEntityId'),
    emptyEntityId: field('emptyEntityId'),
    resetEntityId: field('resetEntityId'),
    autoCleanEntityId: field('autoCleanEntityId'),
    cleanDelayEntityId: field('cleanDelayEntityId'),
    weightEntityId: field('weightEntityId'),
    visitsEntityId: field('visitsEntityId'),
    durationEntityId: field('durationEntityId'),
    durationMode: field('durationMode') ?? 'daily_total',
    // Una por línea, o separadas por comas.
    faultEntityIds: [...new Set(faults.split(/[\s,]+/).filter(Boolean))],
    poopMinSeconds: field('poopMinSeconds') ?? 90,
  });

  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { error: first ?? tc('invalidData') } as const;
  }
  return { data: parsed.data } as const;
}

type LitterFormData = Extract<Awaited<ReturnType<typeof parseLitterForm>>, { data: unknown }>['data'];

function boxColumns(data: LitterFormData) {
  return {
    model: data.model ?? null,
    cleanEntityId: data.cleanEntityId ?? null,
    emptyEntityId: data.emptyEntityId ?? null,
    resetEntityId: data.resetEntityId ?? null,
    autoCleanEntityId: data.autoCleanEntityId ?? null,
    cleanDelayEntityId: data.cleanDelayEntityId ?? null,
    weightEntityId: data.weightEntityId ?? null,
    visitsEntityId: data.visitsEntityId ?? null,
    durationEntityId: data.durationEntityId ?? null,
    durationMode: data.durationMode,
    faultEntityIds: data.faultEntityIds,
    poopMinSeconds: data.poopMinSeconds,
  };
}

export async function addLitterBox(
  _prev: LitterFormState,
  formData: FormData,
): Promise<LitterFormState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const parsed = await parseLitterForm(formData);
  if ('error' in parsed) return { error: parsed.error };
  const data = parsed.data;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const deviceId = newId();
  const now = new Date();

  await getDb().transaction(async (tx) => {
    await tx.insert(devices).values({
      id: deviceId,
      householdId,
      type: 'litter_box',
      name: data.name,
      haEntityId: data.haEntityId ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(litterBoxes).values({ deviceId, ...boxColumns(data) });
  });

  revalidatePath(PATH);
  return { success: true };
}

export async function editLitterBox(
  deviceId: string,
  _prev: LitterFormState,
  formData: FormData,
): Promise<LitterFormState> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const parsed = await parseLitterForm(formData);
  if ('error' in parsed) return { error: parsed.error };
  const data = parsed.data;

  const db = getDb();
  const [box] = await db
    .select({ poopMinSeconds: litterBoxes.poopMinSeconds })
    .from(devices)
    .innerJoin(litterBoxes, eq(litterBoxes.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!box) return { error: tc('notFound') };

  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ name: data.name, haEntityId: data.haEntityId ?? null, updatedAt: new Date() })
      .where(eq(devices.id, deviceId));
    await tx.update(litterBoxes).set(boxColumns(data)).where(eq(litterBoxes.deviceId, deviceId));
  });

  // Con otro umbral cambian las estimaciones ya guardadas, salvo las corregidas.
  if (box.poopMinSeconds !== data.poopMinSeconds) await reclassifyVisits(deviceId);

  revalidatePath(PATH);
  return { success: true };
}

export async function deleteLitterBox(deviceId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  if (!(await requireRole(session.user.id))) return;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return;

  const db = getDb();
  const [box] = await db
    .select({ id: devices.id })
    .from(devices)
    .innerJoin(litterBoxes, eq(litterBoxes.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!box) return;

  await db.delete(devices).where(eq(devices.id, deviceId));
  revalidatePath(PATH);
}

// ---------- Control ----------------------------------------------------------
//
// Los argumentos de una server action llegan del navegador: los tipos de
// TypeScript no protegen nada, así que cada acción valida lo que recibe.

export type LitterActionResult = { error?: string };

/**
 * El arenero, si es de tu hogar. Cualquier miembro puede limpiar o ajustar la
 * limpieza automática, igual que con el robot.
 */
async function resolveLitterBox(deviceId: string) {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') } as const;
  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') } as const;
  if (typeof deviceId !== 'string') return { error: tc('invalidData') } as const;

  const [box] = await getDb()
    .select({
      clean: litterBoxes.cleanEntityId,
      empty: litterBoxes.emptyEntityId,
      reset: litterBoxes.resetEntityId,
      autoClean: litterBoxes.autoCleanEntityId,
      cleanDelay: litterBoxes.cleanDelayEntityId,
    })
    .from(devices)
    .innerJoin(litterBoxes, eq(litterBoxes.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!box) return { error: tc('notFound') } as const;
  return { box } as const;
}

const domainOf = (entityId: string) => entityId.split('.')[0]!;

export async function runLitterCommand(
  deviceId: string,
  command: LitterCommand,
): Promise<LitterActionResult> {
  const tc = await getTranslations('common');
  const tl = await getTranslations('litter');
  if (!LITTER_COMMANDS.includes(command)) return { error: tc('invalidData') };

  const target = await resolveLitterBox(deviceId);
  if ('error' in target) return { error: target.error };

  const entityId = target.box[command];
  if (!entityId) return { error: tl('noActionEntity') };
  const domain = domainOf(entityId);
  if (!(LITTER_ACTION_DOMAINS as readonly string[]).includes(domain)) return { error: tl('invalidActionEntity') };

  try {
    await callHaService(domain, domain === 'button' ? 'press' : 'turn_on', entityId);
  } catch (err) {
    return { error: `${tl('commandError')}: ${describe(err)}` };
  }

  revalidatePath(PATH);
  return {};
}

/** Enciende o apaga la limpieza automática que hace el arenero tras cada visita. */
export async function setLitterAutoClean(deviceId: string, enabled: boolean): Promise<LitterActionResult> {
  const tc = await getTranslations('common');
  const tl = await getTranslations('litter');
  if (typeof enabled !== 'boolean') return { error: tc('invalidData') };

  const target = await resolveLitterBox(deviceId);
  if ('error' in target) return { error: target.error };
  const entityId = target.box.autoClean;
  if (!entityId) return { error: tl('noActionEntity') };
  const domain = domainOf(entityId);
  if (!(LITTER_TOGGLE_DOMAINS as readonly string[]).includes(domain)) return { error: tl('invalidToggleEntity') };

  try {
    await callHaService(domain, enabled ? 'turn_on' : 'turn_off', entityId);
  } catch (err) {
    return { error: `${tl('commandError')}: ${describe(err)}` };
  }

  revalidatePath(PATH);
  return {};
}

/**
 * Cuánto espera el arenero a limpiar después de que salga el gato. El valor se
 * ajusta a los límites y al paso que anuncia la propia entidad.
 */
export async function setLitterCleanDelay(deviceId: string, value: number): Promise<LitterActionResult> {
  const tc = await getTranslations('common');
  const tl = await getTranslations('litter');
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: tc('invalidData') };

  const target = await resolveLitterBox(deviceId);
  if ('error' in target) return { error: target.error };
  const entityId = target.box.cleanDelay;
  if (!entityId) return { error: tl('noActionEntity') };
  const domain = domainOf(entityId);
  if (!(LITTER_NUMBER_DOMAINS as readonly string[]).includes(domain)) return { error: tl('invalidNumberEntity') };

  const raw = await getRawEntityState(entityId);
  const setting = readNumberSetting(raw?.state, raw?.attributes);
  if (!setting) return { error: tl('settingUnavailable') };

  try {
    await callHaService(domain, 'set_value', entityId, { value: clampToSetting(value, setting) });
  } catch (err) {
    return { error: `${tl('commandError')}: ${describe(err)}` };
  }

  revalidatePath(PATH);
  return {};
}

// ---------- Gatos ------------------------------------------------------------

/** Alta o edición de un gato. Sólo dueños y administradores, como el aparato. */
export async function saveLitterCat(
  catId: string | null,
  name: string,
  referenceWeightKg: number,
): Promise<LitterActionResult> {
  const tc = await getTranslations('common');
  const tl = await getTranslations('litter');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) return { error: tc('noHomeConfigured') };

  const parsed = z
    .object({
      catId: z.string().min(1).max(64).nullable(),
      name: z.string().trim().min(1).max(40),
      referenceWeightKg: z.number().finite().min(0.5).max(20),
    })
    .safeParse({ catId, name, referenceWeightKg });
  if (!parsed.success) return { error: tl('catInvalid') };

  const db = getDb();
  if (parsed.data.catId) {
    const updated = await db
      .update(litterCats)
      .set({ name: parsed.data.name, referenceWeightKg: parsed.data.referenceWeightKg })
      .where(and(eq(litterCats.id, parsed.data.catId), eq(litterCats.householdId, householdId)))
      .returning({ id: litterCats.id });
    if (updated.length === 0) return { error: tc('notFound') };
  } else {
    await db.insert(litterCats).values({
      id: newId(),
      householdId,
      name: parsed.data.name,
      referenceWeightKg: parsed.data.referenceWeightKg,
    });
  }

  // Con otro peso de referencia cambia quién es quién en lo ya registrado.
  await reassignCats(householdId);
  revalidatePath(PATH);
  return {};
}

export async function deleteLitterCat(catId: string): Promise<LitterActionResult> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  if (!(await requireRole(session.user.id))) return { error: tc('forbidden') };

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId || typeof catId !== 'string') return { error: tc('invalidData') };

  await getDb()
    .delete(litterCats)
    .where(and(eq(litterCats.id, catId), eq(litterCats.householdId, householdId)));

  await reassignCats(householdId);
  revalidatePath(PATH);
  return {};
}

// ---------- Corrección de visitas --------------------------------------------

/**
 * Corrige el gato o el tipo de una visita. 'auto' devuelve el campo al cálculo
 * automático. Cualquier miembro puede hacerlo: es quien ve al gato salir.
 */
export async function correctLitterVisit(
  visitId: string,
  change: { catId?: string | null; kind?: LitterVisitKind | 'auto' },
): Promise<LitterActionResult> {
  const tc = await getTranslations('common');
  const session = await auth();
  if (!session?.user?.id) return { error: tc('notAuthenticated') };
  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId || typeof visitId !== 'string' || typeof change !== 'object' || !change) {
    return { error: tc('invalidData') };
  }

  const db = getDb();
  const [visit] = await db
    .select({
      weightKg: litterVisits.weightKg,
      durationS: litterVisits.durationS,
      poopMinSeconds: litterBoxes.poopMinSeconds,
    })
    .from(litterVisits)
    .innerJoin(devices, eq(devices.id, litterVisits.deviceId))
    .innerJoin(litterBoxes, eq(litterBoxes.deviceId, devices.id))
    .where(and(eq(litterVisits.id, visitId), eq(devices.householdId, householdId)))
    .limit(1);
  if (!visit) return { error: tc('notFound') };

  const set: Partial<typeof litterVisits.$inferInsert> = {};

  if (change.catId !== undefined) {
    const cats = await getHouseholdCats(householdId);
    if (change.catId === 'auto') {
      set.catId = nearestCat(visit.weightKg, cats);
      set.catManual = false;
    } else if (change.catId === null || cats.some((cat) => cat.id === change.catId)) {
      // null a mano = "no era ninguno de los gatos" (otro animal, la arena…).
      set.catId = change.catId;
      set.catManual = true;
    } else {
      return { error: tc('invalidData') };
    }
  }

  if (change.kind !== undefined) {
    if (change.kind === 'auto') {
      set.kind = classifyVisit(visit.durationS, visit.poopMinSeconds);
      set.kindManual = false;
    } else if (isLitterVisitKind(change.kind)) {
      set.kind = change.kind;
      set.kindManual = true;
    } else {
      return { error: tc('invalidData') };
    }
  }

  if (Object.keys(set).length === 0) return {};
  await db.update(litterVisits).set(set).where(eq(litterVisits.id, visitId));
  return {};
}
