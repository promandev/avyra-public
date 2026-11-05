import { NextResponse } from 'next/server';

import { collectMetrics } from '@/lib/system-panel';
import { guard } from '../_guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await guard(req, { mutating: false });
  if ('error' in gate) return gate.error;
  return NextResponse.json(await collectMetrics());
}
