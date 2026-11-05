import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Users } from 'lucide-react';

import { listHouseholdMembers } from './actions';
import { MembersClient } from './_components/members-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('members');
  return { title: t('title') };
}

export default async function MembersPage() {
  const data = await listHouseholdMembers();

  if ('error' in data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <Users className="size-10 text-muted-foreground/50" />
        <p className="text-muted-foreground">{data.error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{data.householdName}</h1>
      </header>
      <MembersClient
        householdId={data.householdId}
        currentUserId={data.currentUserId}
        currentRole={data.currentRole}
        members={data.members}
        invites={data.invites}
      />
    </div>
  );
}
