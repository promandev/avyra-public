import 'server-only';
import { lt } from 'drizzle-orm';

import { getDb, cameraDiagLog } from '@pradomotica/db';
import { newId } from './id';

/**
 * Registro interno de fallos de cámara, sólo para el super admin.
 *
 * Los fallos del directo y de las grabaciones son intermitentes ("ahora 404, al
 * rato funciona") y los logs del contenedor se pierden con cada despliegue, así
 * que se guardan en Postgres con lo necesario para saber QUÉ falló y DÓNDE: la
 * fase (webrtc, hls, snapshot, grabaciones…), el código HTTP, y si la petición
 * vino por la LAN o de fuera por el túnel de Cloudflare.
 *
 * Escribir aquí nunca debe romper la petición que lo llama: todo error se traga.
 */

export type CameraLogLevel = 'error' | 'warn' | 'info';
export type CameraLogSource = 'server' | 'client';

export interface CameraLogEntry {
  deviceId: string;
  source?: CameraLogSource;
  level?: CameraLogLevel;
  stage: string;
  message: string;
  httpStatus?: number | null;
  detail?: Record<string, unknown>;
  userId?: string | null;
  /** Para deducir si la petición llegó por la LAN o por Cloudflare. */
  headers?: Headers;
  network?: 'lan' | 'external' | null;
}

const RETENTION_MS = 14 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
/** Mismo fallo repetido dentro de esta ventana → se cuenta, no se escribe. */
const DEDUPE_WINDOW_MS = 60_000;

let lastPruneAt = 0;
const recent = new Map<string, { at: number; suppressed: number }>();

/** Las peticiones que pasan por el túnel llevan cabeceras de Cloudflare. */
export function networkFromHeaders(headers: Headers | undefined): 'lan' | 'external' | null {
  if (!headers) return null;
  return headers.get('cf-ray') || headers.get('cf-connecting-ip') ? 'external' : 'lan';
}

export function logCameraEvent(entry: CameraLogEntry): void {
  void write(entry).catch(() => undefined);
}

async function write(entry: CameraLogEntry): Promise<void> {
  const source = entry.source ?? 'server';
  const level = entry.level ?? 'error';
  const message = entry.message.slice(0, 500);

  // Los segmentos HLS y las miniaturas se piden cada pocos segundos: un mismo
  // fallo llenaría la tabla en minutos. Se escribe el primero y se cuentan los
  // repetidos, que viajan en el siguiente registro de ese mismo fallo.
  const key = `${entry.deviceId}|${source}|${entry.stage}|${entry.httpStatus ?? ''}|${message}`;
  const now = Date.now();
  const prev = recent.get(key);
  if (prev && now - prev.at < DEDUPE_WINDOW_MS) {
    prev.suppressed++;
    return;
  }
  const suppressed = prev?.suppressed ?? 0;
  recent.set(key, { at: now, suppressed: 0 });
  if (recent.size > 500) {
    for (const [k, v] of recent) if (now - v.at > DEDUPE_WINDOW_MS) recent.delete(k);
  }

  const network = entry.network ?? networkFromHeaders(entry.headers);
  const tag = `[camlog] ${level} ${source}/${entry.stage} ${entry.deviceId.slice(-6)}`;
  const line = `${tag}${entry.httpStatus ? ` ${entry.httpStatus}` : ''} ${network ?? ''} — ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);

  const db = getDb();
  await db.insert(cameraDiagLog).values({
    id: newId(),
    deviceId: entry.deviceId,
    source,
    level,
    stage: entry.stage.slice(0, 40),
    httpStatus: entry.httpStatus ?? null,
    message,
    network,
    userId: entry.userId ?? null,
    detail:
      suppressed > 0 || entry.detail
        ? { ...entry.detail, ...(suppressed > 0 && { repeatedBefore: suppressed }) }
        : null,
  });

  if (now - lastPruneAt > PRUNE_EVERY_MS) {
    lastPruneAt = now;
    await db
      .delete(cameraDiagLog)
      .where(lt(cameraDiagLog.occurredAt, new Date(now - RETENTION_MS)));
  }
}
