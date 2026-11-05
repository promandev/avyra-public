import { NextResponse } from 'next/server';

import { importStatement } from '@/lib/finance';
import { FinanceImportError, parseIngStatement } from '@/lib/finance-ing';
import { guard } from '../_guard';

export const dynamic = 'force-dynamic';

/** Un extracto de un año entero pesa unos cientos de KB. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Sube el Excel de movimientos de ING. El fichero se lee en memoria y se
 * descarta: no se guarda en disco, sólo los movimientos (con la descripción
 * cifrada).
 */
export async function POST(req: Request) {
  const gate = await guard(req, { mutating: true, json: false });
  if ('error' in gate) return gate.error;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });

  try {
    const statement = await parseIngStatement(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(await importStatement(gate.userId, statement));
  } catch (err) {
    if (err instanceof FinanceImportError) {
      return NextResponse.json({ error: err.code }, { status: 422 });
    }
    console.error('[finance] import failed:', err);
    return NextResponse.json({ error: 'import_failed' }, { status: 500 });
  }
}
