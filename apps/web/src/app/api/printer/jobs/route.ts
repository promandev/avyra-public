import { NextResponse } from 'next/server';

import { IppError } from '@/lib/ipp';
import {
  detectDocumentFormat,
  isPrinterConfigured,
  parsePageRanges,
  submitJob,
} from '@/lib/printer';
import { PRINT_MAX_BYTES, PRINT_MAX_COPIES } from '@/lib/printer-types';
import { getPrinterSession } from '@/lib/printer-access';

export const dynamic = 'force-dynamic';

/**
 * Sube un archivo y lo manda a imprimir.
 *
 * Es un multipart, que el navegador envía entre orígenes sin preflight, así que
 * además de la sesión se exige que la petición venga de esta misma web.
 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const session = await getPrinterSession();
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!isPrinterConfigured()) {
    return NextResponse.json({ error: 'printer_not_configured' }, { status: 503 });
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > PRINT_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size > PRINT_MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  const document = Buffer.from(await file.arrayBuffer());
  const format = detectDocumentFormat(document, file.name);
  if (!format) return NextResponse.json({ error: 'unsupported_format' }, { status: 415 });

  const copies = Number(form.get('copies') ?? 1);
  if (!Number.isInteger(copies) || copies < 1 || copies > PRINT_MAX_COPIES) {
    return NextResponse.json({ error: 'invalid_copies' }, { status: 400 });
  }

  const colorMode = form.get('colorMode') === 'monochrome' ? 'monochrome' : 'color';

  const rangesInput = String(form.get('pageRanges') ?? '').trim();
  const pageRanges = rangesInput ? parsePageRanges(rangesInput) : null;
  if (rangesInput && !pageRanges) {
    return NextResponse.json({ error: 'invalid_page_ranges' }, { status: 400 });
  }

  try {
    const jobId = await submitJob({
      document,
      fileName: file.name,
      format,
      user: session.user.email ?? 'avyra',
      copies,
      colorMode,
      pageRanges,
    });
    return NextResponse.json({ jobId });
  } catch (err) {
    console.error('[printer] Print-Job failed:', err);
    const detail = err instanceof IppError ? err.message : 'unknown';
    return NextResponse.json({ error: 'print_failed', detail }, { status: 502 });
  }
}
