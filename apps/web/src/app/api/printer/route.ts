import { NextResponse } from 'next/server';

import { getPrinterStatus, isPrinterConfigured, listJobs } from '@/lib/printer';
import type { PrinterPanel } from '@/lib/printer-types';
import { getPrinterSession } from '@/lib/printer-access';

export const dynamic = 'force-dynamic';

/**
 * Estado de la impresora y trabajos recientes, para cualquier miembro del hogar.
 *
 * Las dos lecturas fallan por separado: con la impresora apagada CUPS sigue
 * enseñando la cola, y con CUPS caído aún se puede ver la tinta.
 */
export async function GET() {
  if (!(await getPrinterSession())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!isPrinterConfigured()) {
    return NextResponse.json({ error: 'printer_not_configured' }, { status: 503 });
  }

  const [status, jobs] = await Promise.allSettled([getPrinterStatus(), listJobs()]);
  if (jobs.status === 'rejected') console.error('[printer] Get-Jobs failed:', jobs.reason);

  const panel: PrinterPanel = {
    status: status.status === 'fulfilled' ? status.value : null,
    jobs: jobs.status === 'fulfilled' ? jobs.value : [],
    error: jobs.status === 'rejected' ? 'cups_unavailable' : undefined,
  };
  return NextResponse.json(panel);
}
