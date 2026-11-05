'use client';

import { useActionState, useTransition, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Home,
  Plus,
  Save,
  LogOut,
  Trash2,
  Loader2,
  AlertTriangle,
  Users,
  ChevronDown,
  ChevronUp,
  Crown,
  Shield,
  Eye,
} from 'lucide-react';
import type { HouseholdRole } from '@pradomotica/db';

import {
  createHousehold,
  updateHouseholdById,
  deleteHouseholdById,
  leaveHouseholdById,
  type CreateHouseholdState,
  type UpdateHouseholdState,
  type UserHousehold,
} from '../actions';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_ICONS: Record<HouseholdRole, React.ElementType> = {
  owner: Crown,
  admin: Shield,
  viewer: Eye,
};

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30';

// ─── Household card ───────────────────────────────────────────────────────────

function HouseholdCard({
  household,
  currentUserId,
}: {
  household: UserHousehold;
  currentUserId: string;
}) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [editOpen, setEditOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'leave' | 'delete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, startAction] = useTransition();

  const [updateState, updateAction, updatePending] = useActionState<UpdateHouseholdState, FormData>(
    updateHouseholdById,
    {},
  );

  const canEdit = household.myRole === 'owner' || household.myRole === 'admin';
  const isOwner = household.myRole === 'owner';
  const RoleIcon = ROLE_ICONS[household.myRole];

  const handleLeave = () => {
    setActionError(null);
    startAction(async () => {
      const res = await leaveHouseholdById(household.id);
      if (res.error) setActionError(res.error);
    });
  };

  const handleDelete = () => {
    setActionError(null);
    startAction(async () => {
      const res = await deleteHouseholdById(household.id);
      if (res.error) setActionError(res.error);
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Home className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium truncate">{household.name}</p>
            {household.address && (
              <p className="text-xs text-muted-foreground truncate">{household.address}</p>
            )}
          </div>
        </div>
        <span className="flex items-center gap-1 shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          <RoleIcon className="size-3" />
          {t(`roles.${household.myRole}`)}
        </span>
      </div>

      {/* Members list */}
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-2">
          <Users className="size-3" />
          {t('membersCount', { count: household.members.length })}
        </p>
        <div className="space-y-1.5">
          {household.members.map((m) => {
            const MIcon = ROLE_ICONS[m.role];
            return (
              <div key={m.userId} className="flex items-center gap-2 text-sm">
                <MIcon className="size-3 text-muted-foreground shrink-0" />
                <span className="font-medium">{m.displayName ?? m.email}</span>
                {m.displayName && (
                  <span className="text-xs text-muted-foreground">{m.email}</span>
                )}
                {m.userId === currentUserId && (
                  <span className="text-xs text-primary font-medium">{t('youLabel')}</span>
                )}
                <span className="ml-auto text-xs text-foreground/70">{t(`roles.${m.role}`)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit form (owner/admin only) */}
      {canEdit && (
        <div>
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
          >
            {editOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {t('editNameAddress')}
          </button>
          {editOpen && (
            <form action={updateAction} className="mt-3 space-y-3">
              <input type="hidden" name="householdId" value={household.id} />
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/70">{tc('name')}</label>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={household.name}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/70">
                  {t('addressLabel')}
                  <span className="ml-1 text-[11px] text-foreground/60">{t('addressForWeather')}</span>
                </label>
                <input
                  name="address"
                  maxLength={200}
                  defaultValue={household.address ?? ''}
                  placeholder={t('addressPlaceholder')}
                  className={inputCls}
                />
                <p className="text-[11px] text-foreground/60">
                  {t('addressHint')}
                </p>
              </div>
              {updateState.error && (
                <p className="text-sm text-destructive">{updateState.error}</p>
              )}
              {updateState.success && (
                <p className="text-sm text-green-600 dark:text-green-400">✓ {t('saved')}</p>
              )}
              <button
                type="submit"
                disabled={updatePending}
                className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {updatePending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                {tc('saveChanges')}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-border">
        {!isOwner && (
          <>
            {confirmAction === 'leave' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground/70">{t('confirmLeave')}</span>
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {tc('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleLeave}
                  disabled={actionPending}
                  className="flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                >
                  {actionPending ? <Loader2 className="size-3 animate-spin" /> : <LogOut className="size-3" />}
                  {t('confirmBtn')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmAction('leave')}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50 transition"
              >
                <LogOut className="size-3" />
                {t('leaveHousehold')}
              </button>
            )}
          </>
        )}
        {isOwner && (
          <>
            {confirmAction === 'delete' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground/70">{t('confirmDelete')}</span>
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {tc('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={actionPending}
                  className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {actionPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                  {t('confirmDeleteBtn')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmAction('delete')}
                className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
              >
                <Trash2 className="size-3" />
                {t('deleteHousehold')}
              </button>
            )}
          </>
        )}
        {actionError && (
          <p className="ml-auto flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="size-3 shrink-0" />
            {actionError}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Create household form ────────────────────────────────────────────────────

function CreateHouseholdForm() {
  const t = useTranslations('account');
  const [state, action, pending] = useActionState<CreateHouseholdState, FormData>(
    createHousehold,
    {},
  );

  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 space-y-3">
      <p className="text-sm font-medium flex items-center gap-2">
        <Plus className="size-4 text-muted-foreground" />
        {t('addHousehold')}
      </p>
      <form action={action} className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground/70">{t('householdNameLabel')}</label>
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder={t('householdNamePlaceholder')}
            className={inputCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground/70">
            {t('addressLabel')}
            <span className="ml-1 text-[11px] text-foreground/60">{t('addressForWeather')}</span>
          </label>
          <input
            name="address"
            maxLength={200}
            placeholder={t('addressPlaceholder')}
            className={inputCls}
          />
          <p className="text-[11px] text-foreground/60">
            {t('addressHint')}
          </p>
        </div>
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        {state.success && (
          <p className="text-sm text-green-600 dark:text-green-400">✓ {t('saved')}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t('createHouseholdBtn')}
        </button>
      </form>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  userHouseholds: UserHousehold[];
  currentUserId: string;
}

export function MyHouseholdsTab({ userHouseholds, currentUserId }: Props) {
  const t = useTranslations('account');
  return (
    <div className="space-y-4">
      {userHouseholds.length === 0 ? (
        <p className="text-sm text-foreground/70 italic">{t('noHouseholds')}</p>
      ) : (
        userHouseholds.map((h) => (
          <HouseholdCard key={h.id} household={h} currentUserId={currentUserId} />
        ))
      )}
      <CreateHouseholdForm />
    </div>
  );
}
