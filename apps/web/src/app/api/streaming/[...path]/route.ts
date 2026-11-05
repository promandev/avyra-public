import { NextResponse } from 'next/server';

import { getSuperAdminSession } from '@/lib/super-admin';
import { isAllowed, isMinerConfigured, minerRequest, MinerUnavailableError } from '@/lib/twitch-miner';

export const dynamic = 'force-dynamic';

/**
 * Proxy hacia la API del minero de drops, reservado al super admin.
 *
 * El minero no tiene autenticación propia y su contenedor no publica puerto,
 * así que ésta es la única puerta de entrada. La lista blanca de `twitch-miner`
 * evita que un path arbitrario llegue al contenedor.
 */

function guardResponse(): NextResponse | null {
  if (!isMinerConfigured()) {
    return NextResponse.json({ error: 'miner_not_configured' }, { status: 503 });
  }
  return null;
}

async function handle(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
  method: 'GET' | 'POST',
) {
  const session = await getSuperAdminSession();
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const notReady = guardResponse();
  if (notReady) return notReady;

  const { path } = await ctx.params;
  const joined = path.join('/');
  if (!isAllowed(method, joined)) {
    return NextResponse.json({ error: 'path_not_allowed' }, { status: 404 });
  }

  let body: unknown;
  if (method === 'POST') {
    const raw = await req.text();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
      }
    }
  }

  try {
    const { status, data } = await minerRequest(joined, { method, body });
    return NextResponse.json(data ?? {}, { status });
  } catch (err) {
    if (err instanceof MinerUnavailableError) {
      return NextResponse.json({ error: 'miner_unavailable', detail: err.message }, { status: 503 });
    }
    throw err;
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx, 'GET');
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx, 'POST');
}
