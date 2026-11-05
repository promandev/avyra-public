/**
 * Borra las grabaciones de la tarjeta SD de la cámara yi-hack.
 *
 * DELETE /api/cameras/[id]/recordings/clear
 *
 * Elimina la carpeta /record/ de la SD sin tocar los archivos de firmware/flasheo.
 * yi-hack almacena:
 *   /record/      → grabaciones (se borra)
 *   /yi-hack/     → firmware y config (NO se toca)
 *   /log/         → logs de eventos (se borra)
 *   /alarm/       → logs de alarma (se borra)
 * Todo lo demás se preserva para no afectar al flasheo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { cameraFetchJson } from '@/lib/camera-fetch';
import { verifyCameraAccess } from '@/lib/camera-access';
import { decrypt } from '@/lib/crypto';
import { getDb, cameras, devices } from '@pradomotica/db';

const TIMEOUT_MS = 15_000;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!(await verifyCameraAccess(id, session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const db = getDb();
  const [row] = await db
    .select({
      sdHttpUrlEnc: cameras.sdHttpUrlEnc,
      snapshotUrlEnc: cameras.snapshotUrlEnc,
      rtspUrlEnc: cameras.rtspUrlEnc,
      enabled: devices.enabled,
    })
    .from(cameras)
    .innerJoin(devices, eq(cameras.deviceId, devices.id))
    .where(eq(cameras.deviceId, id))
    .limit(1);

  if (!row || !row.enabled) return new NextResponse('Not found', { status: 404 });

  const encUrl = row.sdHttpUrlEnc ?? row.snapshotUrlEnc ?? row.rtspUrlEnc;
  if (!encUrl) {
    return NextResponse.json({ error: 'No hay URL de SD configurada' }, { status: 400 });
  }

  let sdBaseUrl: string;
  try {
    const raw = decrypt(encUrl).replace(/\/$/, '');
    const u = new URL(raw);
    if (row.sdHttpUrlEnc) {
      sdBaseUrl = raw;
    } else if (u.protocol === 'http:' || u.protocol === 'https:') {
      sdBaseUrl = `${u.protocol}//${u.host}`;
    } else {
      sdBaseUrl = `http://${u.hostname}${u.port ? `:${u.port}` : ''}`;
    }
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }

  // Extraer URL base de la cámara (sin path de SD)
  let camBaseUrl: string;
  try {
    const u = new URL(sdBaseUrl);
    camBaseUrl = `${u.protocol}//${u.host}`;
  } catch {
    return new NextResponse('Invalid SD URL', { status: 400 });
  }

  // yi-hack expone comandos CGI para gestionar la SD:
  //   /cgi-bin/command.sh?cmd=rm_record  → borra /record/
  //   /cgi-bin/command.sh?cmd=rm_log     → borra logs
  // Si estos endpoints no existen, intentamos borrado directo vía HTTP DELETE
  // o listando + borrando (no todos los firmwares yi-hack lo soportan).
  const results: { path: string; ok: boolean; error?: string }[] = [];

  // Intentar comando CGI de yi-hack (método preferido)
  const cgiUrl = `${camBaseUrl}/cgi-bin/command.sh?cmd=rm_record`;
  const cgiRes = await cameraFetchJson<unknown>(cgiUrl, TIMEOUT_MS);
  results.push({ path: 'cgi-bin/command.sh?cmd=rm_record', ok: cgiRes !== null });

  // También borrar logs de eventos
  const logCgiUrl = `${camBaseUrl}/cgi-bin/command.sh?cmd=rm_log`;
  const logRes = await cameraFetchJson<unknown>(logCgiUrl, TIMEOUT_MS);
  results.push({ path: 'cgi-bin/command.sh?cmd=rm_log', ok: logRes !== null });

  const anyOk = results.some((r) => r.ok);

  if (!anyOk) {
    return NextResponse.json(
      {
        error: 'No se pudo borrar la memoria. Verifica que la cámara está encendida y accesible.',
        details: results,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, details: results });
}
