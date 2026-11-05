'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { User, Home, Shield, Crown } from 'lucide-react';

import type { PushCategoryPrefs } from '@/lib/push-categories';
import type { AdminData } from '../admin-actions';
import type { UserHousehold } from '../actions';
import { AccountTab } from './account-tab';
import { MyHouseholdsTab } from './my-households-tab';
import { AdminPanel } from './admin-panel';
import { OwnerTab } from './owner-tab';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = 'account' | 'households' | 'admin' | 'owner';

interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  totpEnabled: boolean;
  isAdmin: boolean;
  pushCategories: PushCategoryPrefs;
}

type AvailableUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
};

interface Props {
  currentUser: CurrentUser;
  userHouseholds: UserHousehold[];
  adminData: AdminData | null;
  allUsers: AvailableUser[] | null;
  vapidPublicKey: string | null;
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: TabId; label: string; icon: React.ElementType }[];
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border pb-px">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={[
            'flex items-center gap-2 whitespace-nowrap rounded-t-md px-4 py-2 text-sm font-medium transition-colors',
            active === id
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          ].join(' ')}
        >
          <Icon className="size-4 shrink-0" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SettingsClient({
  currentUser,
  userHouseholds,
  adminData,
  allUsers,
  vapidPublicKey,
}: Props) {
  const t = useTranslations('account');
  const isOwnerOfAny = !currentUser.isAdmin && userHouseholds.some((h) => h.myRole === 'owner');
  const ownerHouseholds = userHouseholds.filter((h) => h.myRole === 'owner');

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'account', label: t('tabAccount'), icon: User },
    { id: 'households', label: t('tabHouseholds'), icon: Home },
    ...(currentUser.isAdmin ? [{ id: 'admin' as TabId, label: t('tabAdmin'), icon: Shield }] : []),
    ...(isOwnerOfAny ? [{ id: 'owner' as TabId, label: t('tabOwner'), icon: Crown }] : []),
  ];

  const [activeTab, setActiveTab] = useState<TabId>('account');

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </header>

      <TabNav tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="min-h-[400px]">
        {activeTab === 'account' && (
          <AccountTab currentUser={currentUser} vapidPublicKey={vapidPublicKey} />
        )}

        {activeTab === 'households' && (
          <MyHouseholdsTab userHouseholds={userHouseholds} currentUserId={currentUser.id} />
        )}

        {activeTab === 'admin' && currentUser.isAdmin && adminData && (
          <AdminPanel households={adminData.households} allUsers={adminData.allUsers} />
        )}

        {activeTab === 'owner' && isOwnerOfAny && (
          <OwnerTab
            ownerHouseholds={ownerHouseholds}
            currentUserId={currentUser.id}
            allUsers={allUsers ?? []}
          />
        )}
      </div>
    </div>
  );
}

