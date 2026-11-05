import { z } from 'zod';
import type { cameraDiagLog } from '@pradomotica/db';
import { runSql } from '../remote.ts';
import type { Runner } from '../remote.ts';

// Copiado de apps/web/src/app/dashboard/cameras/log/page.tsx (PERIODS / LEVELS).
export const PERIODS = [24, 72, 168, 336] as const;
export const LEVELS = { all: ['error', 'warn', 'info'], warn: ['error', 'warn'], error: ['error'] } as const;

export const inputShape = {
  hours: z.union([z.literal(24), z.literal(72), z.literal(168), z.literal(336)]).default(72),
  level: z.enum(['all', 'warn', 'error']).default('warn'),
  cameraId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  limit: z.number().int().min(1).max(400).default(100),
};
export const inputSchema = z.object(inputShape);
export type Input = z.infer<typeof inputSchema>;

type Row = typeof cameraDiagLog.$inferSelect;

export interface CameraDiagReport {
  cameras: Array<{ id: string; name: string }>;
  summary: Array<{ deviceId: string; stage: Row['stage']; level: Row['level']; n: number }>;
  // Sin user_id a propósito.
  rows: Array<
    Pick<Row, 'source' | 'level' | 'stage' | 'httpStatus' | 'message' | 'network' | 'detail'> & {
      occurredAt: string;
      camera: string;
    }
  >;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function buildSql(input: Input): string {
  const levels = LEVELS[input.level].map(lit).join(',');
  const where = [
    `l.occurred_at >= now() - make_interval(hours => ${input.hours})`,
    `l.level IN (${levels})`,
    input.cameraId ? `l.device_id = ${lit(input.cameraId)}` : null,
  ]
    .filter(Boolean)
    .join(' AND ');
  return `SELECT json_build_object(
  'cameras', (SELECT coalesce(json_agg(json_build_object('id', d.id, 'name', d.name) ORDER BY d.name), '[]'::json)
              FROM devices d JOIN cameras c ON c.device_id = d.id),
  'summary', (SELECT coalesce(json_agg(s ORDER BY s.n DESC), '[]'::json) FROM (
                SELECT l.device_id AS "deviceId", l.stage AS stage, l.level AS level, count(*)::int AS n
                FROM camera_diag_log l WHERE ${where} GROUP BY 1, 2, 3) s),
  'rows', (SELECT coalesce(json_agg(r ORDER BY r."occurredAt" DESC), '[]'::json) FROM (
                SELECT l.occurred_at AS "occurredAt", coalesce(d.name, right(l.device_id, 6)) AS camera,
                       l.source AS source, l.level AS level, l.stage AS stage, l.http_status AS "httpStatus",
                       l.message AS message, l.network AS network, l.detail AS detail
                FROM camera_diag_log l LEFT JOIN devices d ON d.id = l.device_id
                WHERE ${where} ORDER BY l.occurred_at DESC LIMIT ${input.limit}) r)
);`;
}

export async function cameraDiagLogTool(input: Input, run: Runner): Promise<CameraDiagReport> {
  const out = await runSql(buildSql(input), run);
  return JSON.parse(out) as CameraDiagReport;
}
