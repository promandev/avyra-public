import { NextResponse } from 'next/server';

import { deleteDebt, getDebtDetail, updateDebt } from '@/lib/finance';
import { debtSchema, guard, idSchema, invalid, notFound } from '../../_guard';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Historial de pagos y evolución del saldo de una deuda. */
export async function GET(req: Request, { params }: Ctx) {
  const gate = await guard(req, { mutating: false });
  if ('error' in gate) return gate.error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return invalid();
  const detail = await getDebtDetail(gate.userId, id.data);
  if (!detail) return notFound();
  return NextResponse.json(detail, { headers: { 'cache-control': 'no-store' } });
}

export async function PUT(req: Request, { params }: Ctx) {
  const gate = await guard(req, { mutating: true });
  if ('error' in gate) return gate.error;
  const id = idSchema.safeParse((await params).id);
  const parsed = debtSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return invalid();
  if (!(await updateDebt(gate.userId, id.data, parsed.data))) return notFound();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await guard(req, { mutating: true, json: false });
  if ('error' in gate) return gate.error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return invalid();
  if (!(await deleteDebt(gate.userId, id.data))) return notFound();
  return NextResponse.json({ ok: true });
}
