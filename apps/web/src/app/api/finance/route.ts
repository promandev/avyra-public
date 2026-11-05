import { NextResponse } from 'next/server';

import { getOverview } from '@/lib/finance';
import { guard } from './_guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await guard(req, { mutating: false });
  if ('error' in gate) return gate.error;
  return NextResponse.json(await getOverview(gate.userId), {
    headers: { 'cache-control': 'no-store' },
  });
}
