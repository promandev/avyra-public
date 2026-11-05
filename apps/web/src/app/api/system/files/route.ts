import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createEntry,
  deleteEntry,
  listDir,
  readTextFile,
  renameEntry,
  writeTextFile,
} from '@/lib/system-files';
import { clientIp, logPanelEvent } from '@/lib/system-panel';
import { fileErrorResponse, guard } from '../_guard';

export const dynamic = 'force-dynamic';

/** `?op=list&path=…` lista una carpeta; `?op=read&path=…` lee un fichero de texto. */
export async function GET(req: Request) {
  const gate = await guard(req, { mutating: false });
  if ('error' in gate) return gate.error;

  const { searchParams } = new URL(req.url);
  const target = searchParams.get('path') ?? '';
  try {
    if (searchParams.get('op') === 'read') return NextResponse.json(await readTextFile(target));
    return NextResponse.json(await listDir(target));
  } catch (err) {
    return fileErrorResponse(err);
  }
}

const bodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('write'), path: z.string().min(1), content: z.string() }),
  z.object({ op: z.literal('create'), path: z.string().min(1), isDir: z.boolean() }),
  z.object({ op: z.literal('rename'), path: z.string().min(1), newName: z.string().min(1) }),
  z.object({ op: z.literal('delete'), path: z.string().min(1) }),
]);

export async function POST(req: Request) {
  const gate = await guard(req, { mutating: true });
  if ('error' in gate) return gate.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const body = parsed.data;
  const who = `usuario=${gate.session.user?.email ?? '?'} ip=${clientIp(req)}`;

  try {
    switch (body.op) {
      case 'write': {
        const done = await writeTextFile(body.path, body.content);
        await logPanelEvent(`EDITAR ${done} bytes=${Buffer.byteLength(body.content)} ${who}`);
        return NextResponse.json({ path: done });
      }
      case 'create': {
        const done = await createEntry(body.path, body.isDir);
        await logPanelEvent(`CREAR ${body.isDir ? 'carpeta' : 'fichero'} ${done} ${who}`);
        return NextResponse.json({ path: done });
      }
      case 'rename': {
        const done = await renameEntry(body.path, body.newName);
        await logPanelEvent(`RENOMBRAR ${body.path} -> ${done} ${who}`);
        return NextResponse.json({ path: done });
      }
      case 'delete': {
        const done = await deleteEntry(body.path);
        await logPanelEvent(`BORRAR ${done} ${who}`);
        return NextResponse.json({ path: done });
      }
    }
  } catch (err) {
    return fileErrorResponse(err);
  }
}
