import { NextResponse } from 'next/server';

import { getSuperAdminSession } from '@/lib/super-admin';
import { PanelFileError } from '@/lib/system-files';
import { isSameOriginRequest } from '@/lib/system-panel';

/**
 * Puerta común de `/api/system/*`: sólo el super admin, y para lo que escribe
 * en disco además una petición del propio sitio. Devuelve la sesión o la
 * respuesta de rechazo.
 */
export async function guard(req: Request, { mutating }: { mutating: boolean }) {
  const session = await getSuperAdminSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  }
  if (mutating && !isSameOriginRequest(req)) {
    return { error: NextResponse.json({ error: 'cross_site' }, { status: 403 }) } as const;
  }
  return { session } as const;
}

export function fileErrorResponse(err: unknown): NextResponse {
  if (err instanceof PanelFileError) {
    return NextResponse.json({ error: err.code }, { status: err.status });
  }
  throw err;
}
