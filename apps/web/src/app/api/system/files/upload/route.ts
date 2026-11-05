import { NextResponse } from 'next/server';

import { clientIp, logPanelEvent } from '@/lib/system-panel';
import { MAX_UPLOAD_BYTES, saveUpload } from '@/lib/system-files';
import { fileErrorResponse, guard } from '../../_guard';

export const dynamic = 'force-dynamic';

/**
 * Subida de un fichero a una carpeta. Esta ruta queda fuera del matcher del
 * middleware: si pasara por él, Next cortaría el cuerpo a 10 MB.
 */
export async function POST(req: Request) {
  const gate = await guard(req, { mutating: true });
  if ('error' in gate) return gate.error;

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const dest = form?.get('dest');
  const file = form?.get('file');
  if (typeof dest !== 'string' || !(file instanceof File)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const done = await saveUpload(dest, file);
    await logPanelEvent(
      `SUBIR ${done} bytes=${file.size} usuario=${gate.session.user?.email ?? '?'} ip=${clientIp(req)}`,
    );
    return NextResponse.json({ path: done });
  } catch (err) {
    return fileErrorResponse(err);
  }
}
