import { NextResponse } from 'next/server';

import { getTransactions } from '@/lib/finance';
import { guard, invalid } from '../_guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await guard(req, { mutating: false });
  if ('error' in gate) return gate.error;
  const month = new URL(req.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return invalid();
  return NextResponse.json(await getTransactions(gate.userId, month), {
    headers: { 'cache-control': 'no-store' },
  });
}
