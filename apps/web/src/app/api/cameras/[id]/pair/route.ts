import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, tabletAgents } from '@pradomotica/db';
import { decrypt } from '@/lib/crypto';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: deviceId } = await params;

  let body: { secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { secret } = body;
  if (!secret || typeof secret !== 'string') {
    return NextResponse.json({ error: 'secret_required' }, { status: 400 });
  }

  const db = getDb();
  const [agent] = await db
    .select()
    .from(tabletAgents)
    .where(eq(tabletAgents.deviceId, deviceId))
    .limit(1);

  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!agent.pairingSecretEnc) {
    // Already paired
    return NextResponse.json({ error: 'already_paired' }, { status: 409 });
  }

  let storedSecret: string;
  try {
    storedSecret = decrypt(agent.pairingSecretEnc);
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  const providedBuf = Buffer.from(secret.padEnd(storedSecret.length, '\0'));
  const storedBuf = Buffer.from(storedSecret.padEnd(secret.length, '\0'));
  const valid =
    secret.length === storedSecret.length &&
    timingSafeEqual(providedBuf, storedBuf);

  if (!valid) {
    return NextResponse.json({ error: 'invalid_secret' }, { status: 403 });
  }

  const token = randomBytes(48).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  await db
    .update(tabletAgents)
    .set({
      tokenHash,
      pairingSecretEnc: null,
      status: 'idle',
      pairedAt: new Date(),
    })
    .where(eq(tabletAgents.deviceId, deviceId));

  return NextResponse.json({ token });
}
