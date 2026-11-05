import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';

import { getDb, devices, cameras, cameraMotionEvents } from '@pradomotica/db';
import { sendPushToHousehold } from '@/lib/push';
import { newId } from '@/lib/id';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cameras/[id]/motion?type=motion|sound|human|animal
 *
 * Webhook que reciben las cámaras al detectar movimiento, sonido,
 * personas (AI) o mascotas (AI).
 * Solo procesa cámaras que NO sean tablets.
 *
 * Auth opción A — YiHack (HMAC-SHA256 en header X-Signature):
 *   SIGNATURE=$(echo -n "$DEVICE_ID" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
 *   curl -X POST "https://app/api/cameras/$DEVICE_ID/motion?type=motion" \
 *     -H "X-Signature: $SIGNATURE"
 *
 * Auth opción B — IP Webcam / Android (token en query param):
 *   IP Webcam Settings → Motion detection → Motion callback URL:
 *     https://app/api/cameras/DEVICE_ID/motion?token=HMAC_HEX&type=motion
 *   El token es idéntico al HMAC de la opción A (HMAC-SHA256 de deviceId con el secret).
 *
 * Ambas opciones usan el mismo valor HMAC, lo que permite reutilizar el script
 * de yihack o calcular el token una vez con:
 *   node -e "const c=require('crypto');console.log(c.createHmac('sha256','SECRET').update('DEVICE_ID').digest('hex'))"
 *
 * YiHack sound detection hook (ai_human_detection.sh):
 *   curl -X POST "https://app/api/cameras/$DEVICE_ID/motion?type=sound" \
 *     -H "X-Signature: $SIGNATURE"
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: deviceId } = await params;

  const secret = process.env.CAMERA_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const expected = createHmac('sha256', secret).update(deviceId).digest('hex');
  const expBuffer = Buffer.from(expected, 'hex');

  // --- Auth: header X-Signature (YiHack) o query param token (IP Webcam) ---
  const headerSig = req.headers.get('x-signature');
  const querySig  = req.nextUrl.searchParams.get('token');
  const rawSig = headerSig ?? querySig;

  if (!rawSig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }

  // Ignore non-hex tokens to avoid Buffer allocation errors
  if (!/^[0-9a-f]+$/i.test(rawSig)) {
    return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 });
  }

  const sigBuffer = Buffer.from(rawSig, 'hex');
  if (sigBuffer.length !== expBuffer.length || !timingSafeEqual(sigBuffer, expBuffer)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // --- Tipo de detección (motion, sound, human, animal) ---
  const typeParam = req.nextUrl.searchParams.get('type');
  const validTypes = ['motion', 'sound', 'human', 'animal'] as const;
  type EventType = (typeof validTypes)[number];
  const eventType: EventType =
    validTypes.includes(typeParam as EventType) ? (typeParam as EventType) : 'motion';

  // --- Buscar cámara y household ---
  const db = getDb();

  const [device] = await db
    .select({
      id: devices.id,
      name: devices.name,
      householdId: devices.householdId,
      model: cameras.model,
    })
    .from(devices)
    .innerJoin(cameras, eq(cameras.deviceId, devices.id))
    .where(and(eq(devices.id, deviceId), eq(devices.type, 'camera')))
    .limit(1);

  if (!device) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  // --- Ignorar tablets: solo cámaras físicas generan alertas ---
  if (device.model === 'Tablet') {
    return NextResponse.json({ ok: true, skipped: 'tablet' });
  }

  // --- Persistir evento ---
  const eventId = newId();
  const occurredAt = new Date();

  await db.insert(cameraMotionEvents).values({
    id: eventId,
    deviceId,
    occurredAt,
    type: eventType,
  });

  // --- Construir deep link al fragmento de vídeo ---
  const timestamp = occurredAt.toISOString();
  const deepLink = `/dashboard/cameras?camera=${deviceId}&t=${encodeURIComponent(timestamp)}&event=${eventId}`;

  // --- Notificar a todos los miembros del household ---
  const emojiMap: Record<EventType, string> = { motion: '🚨', sound: '🔊', human: '🧑', animal: '🐾' };
  const titleMap: Record<EventType, string> = {
    motion: 'Movimiento detectado',
    sound: 'Sonido detectado',
    human: 'Persona detectada',
    animal: 'Mascota detectada',
  };
  const bodyMap: Record<EventType, string> = {
    motion: 'movimiento',
    sound: 'sonido',
    human: 'una persona',
    animal: 'una mascota',
  };

  await sendPushToHousehold(device.householdId, {
    title: `${emojiMap[eventType]} ${titleMap[eventType]}`,
    body: `La cámara "${device.name}" ha detectado ${bodyMap[eventType]}.`,
    url: deepLink,
  }, 'cameras', deviceId);

  return NextResponse.json({ ok: true, eventId });
}
