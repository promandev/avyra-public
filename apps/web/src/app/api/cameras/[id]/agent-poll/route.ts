import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, tabletAgents } from '@pradomotica/db';

function verifyToken(token: string, storedHash: string): boolean {
  const computed = createHash('sha256').update(token).digest('hex');
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: deviceId } = await params;

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const [agent] = await db
    .select()
    .from(tabletAgents)
    .where(eq(tabletAgents.deviceId, deviceId))
    .limit(1);

  if (!agent?.tokenHash || !verifyToken(token, agent.tokenHash)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const command = agent.pendingCommand ?? null;

  await db
    .update(tabletAgents)
    .set({ pendingCommand: null, lastSeenAt: new Date() })
    .where(eq(tabletAgents.deviceId, deviceId));

  return NextResponse.json({ command });
}
