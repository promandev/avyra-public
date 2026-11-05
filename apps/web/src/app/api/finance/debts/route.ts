import { NextResponse } from 'next/server';

import { createDebt } from '@/lib/finance';
import { debtSchema, guard, invalid } from '../_guard';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const gate = await guard(req, { mutating: true });
  if ('error' in gate) return gate.error;
  const parsed = debtSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid();
  const id = await createDebt(gate.userId, parsed.data);
  return NextResponse.json({ id }, { status: 201 });
}
