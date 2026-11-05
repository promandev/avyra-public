import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  addShoppingItem,
  assertAlexaList,
  isHaConfigured,
  removeShoppingItems,
  ShoppingError,
  updateShoppingItem,
} from '@/lib/shopping';
import { SHOPPING_ITEM_MAX_LENGTH } from '@/lib/shopping-types';
import { getShoppingSession } from '@/lib/shopping-access';

export const dynamic = 'force-dynamic';

const listId = z.string().regex(/^todo\.[a-z0-9_]+$/);
const summary = z.string().trim().min(1).max(SHOPPING_ITEM_MAX_LENGTH);
const uid = z.string().min(1).max(512);

const addSchema = z.object({ list: listId, summary });
const updateSchema = z
  .object({ list: listId, uid, summary: summary.optional(), completed: z.boolean().optional() })
  .refine((b) => b.summary !== undefined || b.completed !== undefined);
const removeSchema = z.object({ list: listId, uids: z.array(uid).min(1).max(200) });

type Handler<T> = (body: T) => Promise<void>;

/**
 * Envoltorio común: sesión, cuerpo JSON válido y que la lista sea de Alexa.
 *
 * Exigir `application/json` obliga al navegador a hacer preflight en una
 * petición entre orígenes, que es lo que frena un CSRF aquí.
 */
async function mutate<T extends { list: string }>(
  req: Request,
  schema: z.ZodType<T>,
  run: Handler<T>,
) {
  if (!(await getShoppingSession())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 415 });
  }
  if (!isHaConfigured()) {
    return NextResponse.json({ error: 'ha_not_configured' }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    await assertAlexaList(parsed.data.list);
    await run(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ShoppingError && err.code === 'list_not_found') {
      return NextResponse.json({ error: 'list_not_found' }, { status: 404 });
    }
    console.error('[shopping] write failed:', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 502 });
  }
}

export function POST(req: Request) {
  return mutate(req, addSchema, (b) => addShoppingItem(b.list, b.summary));
}

export function PATCH(req: Request) {
  return mutate(req, updateSchema, (b) =>
    updateShoppingItem(b.list, b.uid, { summary: b.summary, completed: b.completed }),
  );
}

export function DELETE(req: Request) {
  return mutate(req, removeSchema, (b) => removeShoppingItems(b.list, b.uids));
}
