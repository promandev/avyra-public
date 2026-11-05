/**
 * Recibe los fallos que sólo ve el navegador y los guarda en el registro
 * interno de cámaras (ver lib/camera-log.ts).
 *
 * POST /api/cameras/[id]/log
 *   Body JSON: { level, stage, message, httpStatus?, detail? }
 *
 * Hace falta porque buena parte de los fallos nunca llegan a la app: un 524
 * del túnel de Cloudflare, un ICE de WebRTC que no conecta, o una sesión HLS
 * que caduca en go2rtc y el reproductor recibe 404.
 */
import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';
import { logCameraEvent, type CameraLogLevel } from '@/lib/camera-log';

const LEVELS = new Set<CameraLogLevel>(['error', 'warn', 'info']);
const STAGES = new Set(['webrtc', 'hls', 'player', 'snapshot', 'recordings', 'feed']);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4000) return new NextResponse('Too large', { status: 413 });
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }

  const level = body.level as CameraLogLevel;
  const stage = body.stage as string;
  const message = typeof body.message === 'string' ? body.message : '';
  if (!LEVELS.has(level) || !STAGES.has(stage) || !message) {
    return new NextResponse('Bad request', { status: 400 });
  }
  const httpStatus =
    typeof body.httpStatus === 'number' && Number.isInteger(body.httpStatus)
      ? body.httpStatus
      : null;
  const detail =
    body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)
      ? (body.detail as Record<string, unknown>)
      : {};

  logCameraEvent({
    deviceId: id,
    source: 'client',
    level,
    stage,
    message,
    httpStatus,
    userId: session.user.id,
    headers: req.headers,
    detail: {
      ...detail,
      ua: (req.headers.get('user-agent') ?? '').slice(0, 120),
    },
  });

  return new NextResponse(null, { status: 204 });
}
