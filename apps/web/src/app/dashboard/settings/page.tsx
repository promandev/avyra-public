import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { getDb, users } from '@pradomotica/db';
import { eq } from 'drizzle-orm';

import { SettingsClient } from './_components/settings-client';
import { getAdminData } from './admin-actions';
import { getUserHouseholds } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const db = getDb();
  const [userRow] = await db
    .select({
      totpEnabled: users.totpEnabled,
      isAdmin: users.isAdmin,
      email: users.email,
      displayName: users.displayName,
      pushCameras: users.pushCameras,
      pushLights: users.pushLights,
      pushHeating: users.pushHeating,
      pushAc: users.pushAc,
      pushVacuum: users.pushVacuum,
      pushLitter: users.pushLitter,
      pushPrinter: users.pushPrinter,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!userRow) return null;

  const currentUser = {
    id: session.user.id,
    email: userRow.email,
    displayName: userRow.displayName,
    totpEnabled: userRow.totpEnabled,
    isAdmin: userRow.isAdmin,
    pushCategories: {
      cameras: userRow.pushCameras,
      lights: userRow.pushLights,
      heating: userRow.pushHeating,
      ac: userRow.pushAc,
      vacuum: userRow.pushVacuum,
      litter: userRow.pushLitter,
      printer: userRow.pushPrinter,
    },
  };

  const [userHouseholds, adminData] = await Promise.all([
    getUserHouseholds(session.user.id),
    userRow.isAdmin ? getAdminData() : Promise.resolve(null),
  ]);

  const isOwnerOfAny = userHouseholds.some((h) => h.myRole === 'owner');
  const needsAllUsers = userRow.isAdmin || isOwnerOfAny;

  // allUsers is needed for admin and owner panels to select members to add
  let allUsers: Array<{ id: string; email: string; displayName: string | null; isAdmin: boolean }> | null = null;
  if (needsAllUsers && !userRow.isAdmin) {
    // For owners (non-admin), fetch all users for the add-member dropdown
    const rows = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName, isAdmin: users.isAdmin })
      .from(users);
    allUsers = rows;
  }

  return (
    <SettingsClient
      currentUser={currentUser}
      userHouseholds={userHouseholds}
      adminData={adminData && !('error' in adminData) ? adminData : null}
      allUsers={allUsers}
      vapidPublicKey={env.VAPID_PUBLIC_KEY ?? null}
    />
  );
}

