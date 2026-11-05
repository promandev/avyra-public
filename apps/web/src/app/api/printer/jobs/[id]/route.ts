import { NextResponse } from 'next/server';

import { IppError } from '@/lib/ipp';
import { cancelJob, isPrinterConfigured } from '@/lib/printer';
import { getPrinterSession } from '@/lib/printer-access';

export const dynamic = 'force-dynamic';

/** Cancela un trabajo pendiente o en curso. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getPrinterSession();
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!isPrinterConfigured()) {
    return NextResponse.json({ error: 'printer_not_configured' }, { status: 503 });
  }

  const jobId = Number((await ctx.params).id);
  if (!Number.isInteger(jobId) || jobId < 1) {
    return NextResponse.json({ error: 'invalid_job' }, { status: 400 });
  }

  try {
    await cancelJob(jobId, session.user.email ?? 'avyra');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[printer] Cancel-Job failed:', err);
    const detail = err instanceof IppError ? err.message : 'unknown';
    return NextResponse.json({ error: 'cancel_failed', detail }, { status: 502 });
  }
}
