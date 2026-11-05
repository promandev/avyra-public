import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb, shoppingListPrefs } from '@pradomotica/db';

/** Orden guardado de las listas del hogar; vacío si nunca se ha tocado. */
export async function getListOrder(householdId: string): Promise<string[]> {
  try {
    const [row] = await getDb()
      .select({ listOrder: shoppingListPrefs.listOrder })
      .from(shoppingListPrefs)
      .where(eq(shoppingListPrefs.householdId, householdId))
      .limit(1);
    return row?.listOrder ?? [];
  } catch (err) {
    // Sin la tabla (migración pendiente) la sección sigue con el orden por defecto.
    console.error('[shopping] list order read failed:', err);
    return [];
  }
}

export async function setListOrder(householdId: string, order: string[]): Promise<void> {
  await getDb()
    .insert(shoppingListPrefs)
    .values({ householdId, listOrder: order })
    .onConflictDoUpdate({
      target: shoppingListPrefs.householdId,
      set: { listOrder: order, updatedAt: new Date() },
    });
}
