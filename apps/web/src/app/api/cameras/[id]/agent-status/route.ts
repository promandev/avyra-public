import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, tabletAgents } from '@pradomotica/db';
import { verifyCameraAccess } from '@/lib/camera-access';

function verifyToken(token: string, storedHash: string): boolean {
  const computed = createHash('sha256').update(token).digest('hex');
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: deviceId } = await params;

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { status } = body;
  if (status !== 'idle' && status !== 'streaming') {
    return NextResponse.json({ error: 'status must be idle or streaming' }, { status: 400 });
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

  await db
    .update(tabletAgents)
    .set({ status, lastSeenAt: new Date() })
    .where(eq(tabletAgents.deviceId, deviceId));

  return NextResponse.json({ ok: true });
}

// Dashboard query: get agent status (requires user session, not agent token)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: deviceId } = await params;

  // Import auth dynamically to avoid circular dep issues
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!(await verifyCameraAccess(deviceId, session.user.id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const db = getDb();
  const [agent] = await db
    .select({
      status: tabletAgents.status,
      lastSeenAt: tabletAgents.lastSeenAt,
      paired: tabletAgents.tokenHash,
    })
    .from(tabletAgents)
    .where(eq(tabletAgents.deviceId, deviceId))
    .limit(1);

  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Consider online if seen in last 30 seconds
  const isOnline = agent.lastSeenAt
    ? Date.now() - agent.lastSeenAt.getTime() < 30_000
    : false;

  return NextResponse.json({
    status: agent.status,
    paired: !!agent.paired,
    online: isOnline,
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
  });
}
