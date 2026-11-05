import { NextResponse } from 'next/server';

import { deleteImport } from '@/lib/finance';
import { guard, idSchema, invalid, notFound } from '../../_guard';

export const dynamic = 'force-dynamic';

/** Deshace una importación: borra los movimientos que entraron con ella. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard(req, { mutating: true, json: false });
  if ('error' in gate) return gate.error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return invalid();
  if (!(await deleteImport(gate.userId, id.data))) return notFound();
  return NextResponse.json({ ok: true });
}
