'use client';

import { useActionState, useState, useTransition } from 'react';
import { Copy, Check, UserMinus, Trash2, Loader2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { HouseholdRole } from '@pradomotica/db';

import { createInvite, revokeInvite, removeMember, type InviteState } from '../actions';

// ─── Types ────────────────────────────────────────────────────────────────────

type Member = {
  userId: string;
  role: HouseholdRole;
  joinedAt: Date | null;
  email: string;
  displayName: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: HouseholdRole;
  expiresAt: Date;
  createdAt: Date;
};

interface Props {
  householdId: string;
  currentUserId: string;
  currentRole: HouseholdRole;
  members: Member[];
  invites: Invite[];
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: HouseholdRole }) {
  const t = useTranslations('members');
  const colors: Record<HouseholdRole, string> = {
    owner:  'bg-primary/15 text-primary',
    admin:  'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    viewer: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[role]}`}>
      {t(`roles.${role}`)}
    </span>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const t = useTranslations('members');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/50 px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
      title={t('copyLink')}
    >
      {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      {copied ? t('copied') : t('copyLink')}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MembersClient({
  currentUserId,
  currentRole,
  members,
  invites,
}: Props) {
  const t = useTranslations('members');
  const canManage = currentRole === 'owner' || currentRole === 'admin';

  const [inviteState, inviteAction, invitePending] = useActionState<InviteState, FormData>(
    createInvite,
    {},
  );

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleRemove = (userId: string) => {
    setRemovingId(userId);
    startTransition(async () => {
      await removeMember(userId);
      setRemovingId(null);
    });
  };

  const handleRevoke = (inviteId: string) => {
    setRevokingId(inviteId);
    startTransition(async () => {
      await revokeInvite(inviteId);
      setRevokingId(null);
    });
  };

  return (
    <div className="space-y-8">
      {/* Members list */}
      <section>
        <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 bg-card px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {(m.displayName ?? m.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.displayName ?? m.email}
                  {m.userId === currentUserId && (
                    <span className="ml-2 text-xs text-muted-foreground">({t('you')})</span>
                  )}
                </p>
                {m.displayName && (
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                )}
              </div>
              <RoleBadge role={m.role} />
              {canManage && m.userId !== currentUserId && m.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => handleRemove(m.userId)}
                  disabled={removingId === m.userId}
                  className="ml-2 rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  title={t('removeMember')}
                >
                  {removingId === m.userId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserMinus className="size-4" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {t('pendingInvites')}
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('expiresAt', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                  </p>
                </div>
                <RoleBadge role={inv.role} />
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(inv.id)}
                    disabled={revokingId === inv.id}
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    title={t('revokeInvite')}
                  >
                    {revokingId === inv.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Invite form */}
      {canManage && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {t('inviteNew')}
          </h2>
          <form action={inviteAction} className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                name="email"
                type="email"
                required
                placeholder={t('inviteEmailPlaceholder')}
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <select
                name="role"
                defaultValue="viewer"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="admin">{t('roles.admin')}</option>
                <option value="viewer">{t('roles.viewer')}</option>
              </select>
              <button
                type="submit"
                disabled={invitePending}
                className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {invitePending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UserPlus className="size-4" />
                )}
                {t('sendInvite')}
              </button>
            </div>

            {inviteState.error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {inviteState.error}
              </p>
            )}

            {inviteState.inviteUrl && (
              <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 space-y-2">
                <p className="text-sm text-green-700 dark:text-green-400">{t('inviteCreated')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                    {inviteState.inviteUrl}
                  </code>
                  <CopyButton text={inviteState.inviteUrl} />
                </div>
              </div>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
