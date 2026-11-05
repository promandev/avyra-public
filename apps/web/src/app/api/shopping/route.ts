import { NextResponse } from 'next/server';

import { getShoppingItems, getShoppingLists, isHaConfigured, ShoppingError } from '@/lib/shopping';
import type { ShoppingPanel } from '@/lib/shopping-types';
import { getShoppingAccess } from '@/lib/shopping-access';
import { getListOrder } from '@/lib/shopping-prefs';

export const dynamic = 'force-dynamic';

/**
 * Listas de Alexa, en el orden del hogar, y los elementos de una de ellas
 * (`?list=todo.xxx`, o la primera del orden).
 */
export async function GET(req: Request) {
  const access = await getShoppingAccess();
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!isHaConfigured()) {
    return NextResponse.json({ error: 'ha_not_configured' }, { status: 503 });
  }

  try {
    const lists = await getShoppingLists(await getListOrder(access.householdId));
    const wanted = new URL(req.url).searchParams.get('list');
    const list = lists.find((l) => l.id === wanted) ?? lists[0] ?? null;
    const panel: ShoppingPanel = {
      lists,
      listId: list?.id ?? null,
      items: list ? await getShoppingItems(list.id) : [],
      canManage: access.canManage,
    };
    return NextResponse.json(panel);
  } catch (err) {
    console.error('[shopping] read failed:', err);
    const code = err instanceof ShoppingError ? err.code : 'ha_unavailable';
    return NextResponse.json({ error: code }, { status: 502 });
  }
}
