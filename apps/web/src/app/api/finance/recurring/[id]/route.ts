import { NextResponse } from 'next/server';

import { deleteRecurring, updateRecurring } from '@/lib/finance';
import { guard, idSchema, invalid, notFound, recurringSchema } from '../../_guard';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const gate = await guard(req, { mutating: true });
  if ('error' in gate) return gate.error;
  const id = idSchema.safeParse((await params).id);
  const parsed = recurringSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return invalid();
  if (!(await updateRecurring(gate.userId, id.data, parsed.data))) return notFound();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await guard(req, { mutating: true, json: false });
  if ('error' in gate) return gate.error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return invalid();
  if (!(await deleteRecurring(gate.userId, id.data))) return notFound();
  return NextResponse.json({ ok: true });
}
