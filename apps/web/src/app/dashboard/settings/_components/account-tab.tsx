'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { User, KeyRound, Loader2, Save } from 'lucide-react';

import { TotpSetup } from './totp-setup';
import { PushSubscriptionToggle } from './push-subscription-toggle';
import { PushCategoryToggles } from './push-category-toggles';
import type { PushCategoryPrefs } from '@/lib/push-categories';
import {
  updateDisplayName,
  changePassword,
  type UpdateDisplayNameState,
  type ChangePasswordState,
} from '../actions';

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30';

function TabSection({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </h3>
      {children}
    </section>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  currentUser: {
    id: string;
    email: string;
    displayName: string | null;
    totpEnabled: boolean;
    isAdmin: boolean;
    pushCategories: PushCategoryPrefs;
  };
  vapidPublicKey: string | null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AccountTab({ currentUser, vapidPublicKey }: Props) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [nameState, nameAction, namePending] = useActionState<UpdateDisplayNameState, FormData>(
    updateDisplayName,
    {},
  );

  const [pwState, pwAction, pwPending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    {},
  );

  return (
    <div className="space-y-5">
      {/* ── Perfil ── */}
      <TabSection title={t('profileTitle')} icon={User}>
        <form action={nameAction} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">{t('displayName')}</label>
            <input
              name="displayName"
              required
              maxLength={80}
              defaultValue={currentUser.displayName ?? ''}
              placeholder="Tu nombre"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">{t('emailLabel')}</label>
            <input
              type="email"
              value={currentUser.email}
              disabled
              className={`${inputCls} opacity-60 cursor-not-allowed`}
            />
            <p className="text-xs text-foreground/60">{t('emailReadonly')}</p>
          </div>
          {nameState.error && (
            <p className="text-sm text-destructive">{nameState.error}</p>
          )}
          {nameState.success && (
            <p className="text-sm text-green-600 dark:text-green-400">✓ {t('nameUpdated')}</p>
          )}
          <button
            type="submit"
            disabled={namePending}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {namePending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {tc('saveChanges')}
          </button>
        </form>
      </TabSection>

      {/* ── Cambiar contraseña ── */}
      <TabSection title={t('changePasswordTitle')} icon={KeyRound}>
        <form action={pwAction} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">{t('currentPassword')}</label>
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">{t('newPassword')}</label>
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">{t('confirmNewPassword')}</label>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className={inputCls}
            />
          </div>
          {pwState.error && (
            <p className="text-sm text-destructive">{pwState.error}</p>
          )}
          {pwState.success && (
            <p className="text-sm text-green-600 dark:text-green-400">✓ {t('passwordUpdated')}</p>
          )}
          <button
            type="submit"
            disabled={pwPending}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {pwPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {t('changePasswordBtn')}
          </button>
        </form>
      </TabSection>

      {/* ── Seguridad (2FA) ── */}
      <TotpSetup totpEnabled={currentUser.totpEnabled} />

      {/* ── Notificaciones push ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('pushTitle')}</h3>
          {vapidPublicKey ? (
            <PushSubscriptionToggle vapidPublicKey={vapidPublicKey} showDiagnostics={currentUser.isAdmin} />
          ) : (
            <p className="text-sm text-destructive">
              {t('pushDisabledServer')}
            </p>
          )}
        </div>

        {/* Los interruptores por categoría se enseñan siempre: se puede dejar
            preparado lo que quieres recibir antes de activar el aviso, o desde
            otro dispositivo. */}
        {vapidPublicKey && <PushCategoryToggles prefs={currentUser.pushCategories} />}
      </div>
    </div>
  );
}
