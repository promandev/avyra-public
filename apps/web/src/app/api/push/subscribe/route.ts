import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';

import { getDb, pushSubscriptions, users } from '@pradomotica/db';
import { auth } from '@/lib/auth';
import { newId } from '@/lib/id';

export const dynamic = 'force-dynamic';

// POST /api/push/subscribe — registra o actualiza una suscripción push.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription object' }, { status: 400 });
  }

  const db = getDb();

  const [userRow] = await db
    .select({ pushEnabled: users.pushEnabled })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!userRow?.pushEnabled) {
    return NextResponse.json({ error: 'push_disabled_by_admin' }, { status: 403 });
  }

  // Upsert: si el endpoint ya existe para este usuario, actualizar; si no, insertar.
  const existing = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, session.user.id),
        eq(pushSubscriptions.endpoint, body.endpoint),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(pushSubscriptions)
      .set({ p256dh: body.keys.p256dh, auth: body.keys.auth })
      .where(eq(pushSubscriptions.id, existing[0]!.id));
  } else {
    await db.insert(pushSubscriptions).values({
      id: newId(),
      userId: session.user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/push/subscribe — elimina la suscripción del dispositivo actual.
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { endpoint?: string };
  if (!body.endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
  }

  const db = getDb();
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, session.user.id),
        eq(pushSubscriptions.endpoint, body.endpoint),
      ),
    );

  return NextResponse.json({ ok: true });
}
