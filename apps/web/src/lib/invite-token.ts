import 'server-only';
import { createHash } from 'node:crypto';

/** Hash SHA-256 del token de invitación tal y como se guarda en la BD. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
