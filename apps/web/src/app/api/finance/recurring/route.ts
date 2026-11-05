import { NextResponse } from 'next/server';

import { createRecurring } from '@/lib/finance';
import { guard, invalid, recurringSchema } from '../_guard';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const gate = await guard(req, { mutating: true });
  if ('error' in gate) return gate.error;
  const parsed = recurringSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid();
  const id = await createRecurring(gate.userId, parsed.data);
  return NextResponse.json({ id }, { status: 201 });
}
