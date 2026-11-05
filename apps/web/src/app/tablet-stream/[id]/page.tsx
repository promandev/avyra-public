import { redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getActiveHouseholdId } from '@/lib/household';
import { getDb, cameras, devices } from '@pradomotica/db';
import { TabletStreamer } from './tablet-streamer';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TabletStreamPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;

  const householdId = await getActiveHouseholdId(session.user.id);
  if (!householdId) redirect('/onboarding');

  const db = getDb();
  const [row] = await db
    .select({
      id: devices.id,
      name: devices.name,
      go2rtcStreamId: cameras.go2rtcStreamId,
      enabled: devices.enabled,
    })
    .from(devices)
    .innerJoin(cameras, eq(cameras.deviceId, devices.id))
    .where(and(eq(devices.id, id), eq(devices.householdId, householdId)))
    .limit(1);

  if (!row || !row.enabled) redirect('/dashboard/cameras');

  return (
    <TabletStreamer
      cameraId={row.id}
      cameraName={row.name}
      streamId={row.go2rtcStreamId ?? row.id}
    />
  );
}
