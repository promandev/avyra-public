import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getShoppingLists, isHaConfigured } from '@/lib/shopping';
import { getShoppingAccess } from '@/lib/shopping-access';
import { setListOrder } from '@/lib/shopping-prefs';

export const dynamic = 'force-dynamic';

const schema = z.object({
  order: z
    .array(z.string().regex(/^todo\.[a-z0-9_]+$/))
    .min(1)
    .max(50),
});

/**
 * Guarda el orden de las listas del hogar. Sólo propietario o admin.
 *
 * Como en `/api/shopping/items`, exigir `application/json` fuerza el preflight
 * en una petición entre orígenes.
 */
export async function PUT(req: Request) {
  const access = await getShoppingAccess();
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!access.canManage) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 415 });
  }
  if (!isHaConfigured()) {
    return NextResponse.json({ error: 'ha_not_configured' }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    // Sólo se guardan listas que existen en Alexa, sin repetir.
    const known = new Set((await getShoppingLists()).map((l) => l.id));
    const order = [...new Set(parsed.data.order)].filter((id) => known.has(id));
    await setListOrder(access.householdId, order);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[shopping] save order failed:', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 502 });
  }
}
