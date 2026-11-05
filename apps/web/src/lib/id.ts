import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/** UUID v7-ish: timestamp + random. Suficiente para PKs ordenadas. */
export function newId(): string {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

/** Hash estable de IP para audit logging sin guardar IP en claro. */
export function hashIp(ip: string | null | undefined, salt: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
