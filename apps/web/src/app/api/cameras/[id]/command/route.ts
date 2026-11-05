import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, tabletAgents } from '@pradomotica/db';
import { auth } from '@/lib/auth';
import { verifyCameraAccess } from '@/lib/camera-access';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id: cameraId } = await params;

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { action } = body;
  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json({ error: 'action must be start or stop' }, { status: 400 });
  }

  if (!(await verifyCameraAccess(cameraId, session.user.id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const db = getDb();
  await db
    .update(tabletAgents)
    .set({ pendingCommand: action })
    .where(eq(tabletAgents.deviceId, cameraId));

  return NextResponse.json({ ok: true });
}
