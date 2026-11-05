'use client';

import { useActionState, useTransition, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  Shield,
  Eye,
} from 'lucide-react';
import type { HouseholdRole } from '@pradomotica/db';

import {
  ownerUpdateHousehold,
  ownerDeleteHousehold,
  ownerAddMember,
  ownerRemoveMember,
  ownerUpdateMemberRole,
  type OwnerActionResult,
} from '../owner-actions';
import type { UserHousehold } from '../actions';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES: HouseholdRole[] = ['owner', 'admin', 'viewer'];
const ROLE_ICONS: Record<HouseholdRole, React.ElementType> = {
  owner: Crown,
  admin: Shield,
  viewer: Eye,
};

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30';
const selectCls =
  'rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30';

function StateMsg({ state }: { state: OwnerActionResult }) {
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

// ─── Available user type ──────────────────────────────────────────────────────

type AvailableUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
};

// ─── Add member form ──────────────────────────────────────────────────────────

function AddMemberForm({
  householdId,
  allUsers,
  existingUserIds,
}: {
  householdId: string;
  allUsers: AvailableUser[];
  existingUserIds: Set<string>;
}) {
  const t = useTranslations('account');
  const [state, action, pending] = useActionState<OwnerActionResult, FormData>(
    ownerAddMember,
    {},
  );

  const available = allUsers.filter((u) => !existingUserIds.has(u.id));
  if (available.length === 0) return null;

  return (
    <form action={action} className="flex flex-wrap gap-2 pt-2 border-t border-border">
      <input type="hidden" name="householdId" value={householdId} />
      <select name="userId" required className={selectCls}>
        <option value="">{t('selectUser')}</option>
        {available.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName ?? u.email}
            {u.isAdmin ? ` (${t('adminGlobal')})` : ''}
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
  currentUserId,
  allUsers,
}: {
  member: UserHousehold['members'][number];
  householdId: string;
  currentUserId: string;
  allUsers: AvailableUser[];
}) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [roleState, roleAction, rolePending] = useActionState<OwnerActionResult, FormData>(
    ownerUpdateMemberRole,
    {},
  );
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isCurrentUser = member.userId === currentUserId;
  const targetUser = allUsers.find((u) => u.id === member.userId);
  const isGlobalAdmin = targetUser?.isAdmin ?? false;

  const handleRemove = () => {
    setRemoveError(null);
    setRemoving(true);
    startTransition(async () => {
      const res = await ownerRemoveMember(householdId, member.userId);
      if (res.error) {
        setRemoveError(res.error);
        setRemoving(false);
      }
    });
  };

  const RoleIcon = ROLE_ICONS[member.role];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm">
      <RoleIcon className="size-3.5 text-foreground/70 shrink-0" />
      <span className="font-medium">{member.displayName ?? member.email}</span>
      {member.displayName && (
        <span className="text-xs text-foreground/70">{member.email}</span>
      )}
      {isGlobalAdmin && (
        <Shield className="size-3 text-amber-500" aria-label="Administrador global" />
      )}
      {isCurrentUser && <span className="text-xs text-primary">{t('youLabel')}</span>}

      <div className="ml-auto flex items-center gap-2">
        {!isCurrentUser && !isGlobalAdmin ? (
          <form action={roleAction} className="flex items-center gap-1.5">
            <input type="hidden" name="householdId" value={householdId} />
            <input type="hidden" name="userId" value={member.userId} />
            <select
              name="role"
              defaultValue={member.role}
              className={`${selectCls} text-xs py-1`}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={rolePending}
              title={tc('save')}
              className="rounded-md border border-input px-2 py-1 text-xs transition hover:bg-accent disabled:opacity-50"
            >
              {rolePending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            </button>
          </form>
        ) : (
          <span className="text-xs text-foreground/70">{t(`roles.${member.role}`)}</span>
        )}

        {!isCurrentUser && !isGlobalAdmin && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            title={t('removeMember')}
            className="rounded-md border border-destructive/40 p-1 text-destructive hover:bg-destructive hover:text-destructive-foreground transition disabled:opacity-50"
          >
            {removing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
          </button>
        )}
      </div>
      {roleState.error && <div className="w-full"><StateMsg state={roleState} /></div>}
      {removeError && (
        <p className="w-full flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="size-3 shrink-0" />
          {removeError}
        </p>
      )}
    </div>
  );
}

// ─── Household management card ────────────────────────────────────────────────

function OwnerHouseholdCard({
  household,
  currentUserId,
  allUsers,
}: {
  household: UserHousehold;
  currentUserId: string;
  allUsers: AvailableUser[];
}) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [updateState, updateAction, updatePending] = useActionState<OwnerActionResult, FormData>(
    ownerUpdateHousehold,
    {},
  );

  const existingUserIds = new Set(household.members.map((m) => m.userId));

  const handleDelete = () => {
    setDeleteError(null);
    setDeleting(true);
    startTransition(async () => {
      const res = await ownerDeleteHousehold(household.id);
      if (res.error) {
        setDeleteError(res.error);
        setDeleting(false);
      }
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Home className="size-4 shrink-0 text-foreground/70" />
          <div className="min-w-0">
            <p className="font-medium truncate">{household.name}</p>
            {household.address && (
              <p className="text-xs text-foreground/70 truncate">{household.address}</p>
            )}
          </div>
        </div>
        {/* Delete button */}
        <div className="flex items-center gap-2 shrink-0">
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
                className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                {tc('confirm')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title={t('deleteHousehold')}
              className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="size-3 shrink-0" />
          {deleteError}
        </p>
      )}

      {/* Edit form */}
      <div>
        <button
          type="button"
          onClick={() => setEditOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground transition"
        >
          {editOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {t('editNameAddress')}
        </button>
        {editOpen && (
          <form action={updateAction} className="mt-3 space-y-3">
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
              placeholder={t('addressLabel')}
              className={inputCls}
            />
            <StateMsg state={updateState} />
            <button
              type="submit"
              disabled={updatePending}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {updatePending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
              {tc('save')}
            </button>
          </form>
        )}
      </div>

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
              <MemberRow
                key={m.userId}
                member={m}
                householdId={household.id}
                currentUserId={currentUserId}
                allUsers={allUsers}
              />
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

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  ownerHouseholds: UserHousehold[];
  currentUserId: string;
  allUsers: AvailableUser[];
}

export function OwnerTab({ ownerHouseholds, currentUserId, allUsers }: Props) {
  const t = useTranslations('account');
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/70">
        {t('ownerDesc')}
      </p>
      {ownerHouseholds.length === 0 ? (
        <p className="text-sm text-foreground/70 italic">{t('ownerEmpty')}</p>
      ) : (
        ownerHouseholds.map((h) => (
          <OwnerHouseholdCard
            key={h.id}
            household={h}
            currentUserId={currentUserId}
            allUsers={allUsers}
          />
        ))
      )}
    </div>
  );
}
