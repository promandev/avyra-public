'use client';

import { useActionState, useTransition, useState } from 'react';
import {
  Home,
  Users,
  Plus,
  Trash2,
  Save,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Crown,
  Bell,
  BellOff,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { HouseholdRole } from '@pradomotica/db';

import {
  adminCreateHousehold,
  adminUpdateHousehold,
  adminDeleteHousehold,
  adminAddMember,
  adminRemoveMember,
  adminUpdateMemberRole,
  adminSetUserPushEnabled,
  type AdminHousehold,
  type AdminUser,
  type AdminActionResult,
} from '../admin-actions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  households: AdminHousehold[];
  allUsers: AdminUser[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES: HouseholdRole[] = ['owner', 'admin', 'viewer'];

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30';

const selectCls =
  'rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30';

// ─── Error/Success display ────────────────────────────────────────────────────

function StateMsg({ state }: { state: AdminActionResult }) {
  if (state.error) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertTriangle className="size-3 shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return <p className="text-xs text-green-600 dark:text-green-400">✓ Guardado</p>;
  }
  return null;
}

// ─── Edit household form ──────────────────────────────────────────────────────

function EditHouseholdForm({ household }: { household: AdminHousehold }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<AdminActionResult, FormData>(
    adminUpdateHousehold,
    {},
  );
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground transition"
      >
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {t('editNameAddressAdmin')}
      </button>
      {open && (
        <form action={action} className="mt-2 space-y-2">
          <input type="hidden" name="householdId" value={household.id} />
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            defaultValue={household.name}
            placeholder={t('householdNameAdminPlaceholder')}
            className={inputCls}
          />
          <input
            name="address"
            maxLength={200}
            defaultValue={household.address ?? ''}
            placeholder={t('addressAdminPlaceholder')}
            className={inputCls}
          />
          <StateMsg state={state} />
          <button
            type="submit"
            disabled={pending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            {tc('save')}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Add member form ──────────────────────────────────────────────────────────

function AddMemberForm({
  householdId,
  allUsers,
  existingUserIds,
}: {
  householdId: string;
  allUsers: AdminUser[];
  existingUserIds: Set<string>;
}) {
  const t = useTranslations('account');
  const [state, action, pending] = useActionState<AdminActionResult, FormData>(
    adminAddMember,
    {},
  );

  const available = allUsers.filter((u) => !existingUserIds.has(u.id));
  if (available.length === 0) return null;

  return (
    <form action={action} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="householdId" value={householdId} />
      <select name="userId" required className={selectCls}>
        <option value="">{t('selectUser')}</option>
        {available.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName ?? u.email}
          </option>
        ))}
      </select>
      <select name="role" defaultValue="viewer" className={selectCls}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs transition hover:bg-accent disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <UserPlus className="size-3" />}
        {t('addMemberBtn')}
      </button>
      {(state.error || state.success) && (
        <div className="w-full">
          <StateMsg state={state} />
        </div>
      )}
    </form>
  );
}

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({
  member,
  householdId,
}: {
  member: AdminHousehold['members'][number];
  householdId: string;
}) {
  const t = useTranslations('account');
  const [roleState, roleAction, rolePending] = useActionState<AdminActionResult, FormData>(
    adminUpdateMemberRole,
    {},
  );
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleRemove = () => {
    setRemoveError(null);
    setRemoving(true);
    startTransition(async () => {
      const res = await adminRemoveMember(householdId, member.userId);
      if (res.error) {
        setRemoveError(res.error);
        setRemoving(false);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate">{member.displayName ?? member.email}</span>
        {member.displayName && (
          <span className="ml-1 text-xs text-foreground/70 truncate">{member.email}</span>
        )}
      </div>

      <form action={roleAction} className="flex items-center gap-1.5">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="userId" value={member.userId} />
      <select name="role" defaultValue={member.role} className={selectCls}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={rolePending}
          title={t('saved')}
          className="rounded-md border border-input p-1.5 transition hover:bg-accent disabled:opacity-50"
        >
          {rolePending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
        </button>
      </form>

      <button
        type="button"
        onClick={handleRemove}
        disabled={removing}
        title="Quitar del hogar"
        className="rounded-md border border-destructive/40 p-1.5 text-destructive transition hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
      >
        {removing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
      </button>

      {(roleState.error || removeError) && (
        <p className="w-full text-xs text-destructive">
          <AlertTriangle className="mr-1 inline size-3" />
          {roleState.error ?? removeError}
        </p>
      )}
    </div>
  );
}

// ─── Household card ───────────────────────────────────────────────────────────

function HouseholdCard({
  household,
  allUsers,
}: {
  household: AdminHousehold;
  allUsers: AdminUser[];
}) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    setDeleteError(null);
    setDeleting(true);
    startTransition(async () => {
      const res = await adminDeleteHousehold(household.id);
      if (res.error) {
        setDeleteError(res.error);
        setDeleting(false);
        setConfirmDelete(false);
      }
    });
  };

  const existingUserIds = new Set(household.members.map((m) => m.userId));

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Home className="size-4 text-foreground/70" />
            <h3 className="font-semibold">{household.name}</h3>
          </div>
          {household.address && (
            <p className="mt-0.5 text-xs text-foreground/70">{household.address}</p>
          )}
        </div>

        {/* Delete */}
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-foreground/70 hover:text-foreground transition"
              >
                {tc('cancel')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                {t('confirmDeleteBtn')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title={t('deleteHousehold')}
              className="rounded-md border border-destructive/40 p-1.5 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <p className="text-xs text-destructive">
          <AlertTriangle className="mr-1 inline size-3" />
          {deleteError}
        </p>
      )}

      {/* Edit form */}
      <EditHouseholdForm household={household} />

      {/* Members */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/70">
          <Users className="size-3" />
          {t('membersCount', { count: household.members.length })}
        </p>
        {household.members.length === 0 ? (
          <p className="text-xs text-foreground/70 italic">{t('noMembers')}</p>
        ) : (
          <div className="space-y-1.5">
            {household.members.map((m) => (
              <MemberRow key={m.userId} member={m} householdId={household.id} />
            ))}
          </div>
        )}
      </div>

      {/* Add member */}
      <AddMemberForm
        householdId={household.id}
        allUsers={allUsers}
        existingUserIds={existingUserIds}
      />
    </div>
  );
}

// ─── Create household form ────────────────────────────────────────────────────

function CreateHouseholdForm({ allUsers }: { allUsers: AdminUser[] }) {
  const t = useTranslations('account');
  const [state, action, pending] = useActionState<AdminActionResult, FormData>(
    adminCreateHousehold,
    {},
  );

  return (
    <form action={action} className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-medium">{t('addHousehold')}</p>
      <input
        name="name"
        required
        minLength={2}
        maxLength={80}
        placeholder={t('householdNameAdminPlaceholder')}
        className={inputCls}
      />
      <input
        name="address"
        maxLength={200}
        placeholder={t('addressAdminPlaceholder')}
        className={inputCls}
      />
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground/70">{t(`roles.owner`)}</label>
        <select name="ownerId" required className={`${selectCls} w-full`}>
          <option value="">{t('selectUser')}</option>
          {allUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName ?? u.email}
            </option>
          ))}
        </select>
      </div>
      <StateMsg state={state} />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {t('createHouseholdBtn')}
      </button>
    </form>
  );
}

// ─── Users without any household ─────────────────────────────────────────────

function UsersWithoutHousehold({
  allUsers,
  households,
}: {
  allUsers: AdminUser[];
  households: AdminHousehold[];
}) {
  const t = useTranslations('account');
  const allMemberIds = new Set(households.flatMap((h) => h.members.map((m) => m.userId)));
  const orphans = allUsers.filter((u) => !allMemberIds.has(u.id));

  if (orphans.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
        <AlertTriangle className="size-3" />
        {t('usersWithoutHousehold', { count: orphans.length })}
      </p>
      <div className="space-y-1">
        {orphans.map((u) => (
          <div key={u.id} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{u.displayName ?? u.email}</span>
            {u.displayName && <span className="text-xs text-foreground/70">{u.email}</span>}
            {u.isAdmin && (
              <Crown className="size-3 text-amber-500" aria-label="Global admin" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Per-user push notification toggle ────────────────────────────────────────

function UserPushRow({ user }: { user: AdminUser }) {
  const t = useTranslations('account');
  const [enabled, setEnabled] = useState(user.pushEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = () => {
    const next = !enabled;
    setError(null);
    setPending(true);
    startTransition(async () => {
      const res = await adminSetUserPushEnabled(user.id, next);
      if (res.error) {
        setError(res.error);
      } else {
        setEnabled(next);
      }
      setPending(false);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate">{user.displayName ?? user.email}</span>
        {user.displayName && (
          <span className="ml-1 text-xs text-foreground/70 truncate">{user.email}</span>
        )}
        {user.isAdmin && <Crown className="ml-1.5 inline size-3 text-amber-500" aria-label="Global admin" />}
      </div>

      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={[
          'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50',
          enabled
            ? 'border-input hover:bg-accent'
            : 'border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground',
        ].join(' ')}
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : enabled ? (
          <Bell className="size-3" />
        ) : (
          <BellOff className="size-3" />
        )}
        {enabled ? t('pushAdminEnabled') : t('pushAdminDisabled')}
      </button>

      {error && (
        <p className="w-full text-xs text-destructive">
          <AlertTriangle className="mr-1 inline size-3" />
          {error}
        </p>
      )}
    </div>
  );
}

function UsersPushSection({ allUsers }: { allUsers: AdminUser[] }) {
  const t = useTranslations('account');
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Bell className="size-4 text-foreground/70" />
          {t('pushAdminSectionTitle')}
        </p>
        <p className="mt-0.5 text-xs text-foreground/70">{t('pushAdminSectionDesc')}</p>
      </div>
      <div className="space-y-1.5">
        {allUsers.map((u) => (
          <UserPushRow key={u.id} user={u} />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminPanel({ households, allUsers }: Props) {
  const t = useTranslations('account');
  return (
    <div className="space-y-6">
      {/* Users without household warning */}
      <UsersWithoutHousehold allUsers={allUsers} households={households} />

      {/* Push notifications per user */}
      <UsersPushSection allUsers={allUsers} />

      {/* Household cards */}
      {households.length === 0 ? (
        <p className="text-sm text-foreground/70 italic">{t('noHouseholdsAdmin')}</p>
      ) : (
        <div className="space-y-4">
          {households.map((h) => (
            <HouseholdCard key={h.id} household={h} allUsers={allUsers} />
          ))}
        </div>
      )}

      {/* Create household */}
      <CreateHouseholdForm allUsers={allUsers} />
    </div>
  );
}
