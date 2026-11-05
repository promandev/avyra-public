'use client';

import { useActionState, useEffect } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createOwnerAccount, type OnboardingState } from './actions';
import { cn } from '@/lib/utils';

const initial: OnboardingState = {};

export function OnboardingForm() {
  const [state, action, isPending] = useActionState(createOwnerAccount, initial);
  const t = useTranslations('onboarding');

  return (
    <form action={action} className="space-y-4">
      <Field label={t('name')} name="displayName" error={state.errors?.displayName?.[0]}>
        <input
          name="displayName"
          type="text"
          autoComplete="name"
          placeholder={t('namePlaceholder')}
          className={inputClass}
          required
        />
      </Field>

      <Field label={t('email')} name="email" error={state.errors?.email?.[0]}>
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          className={inputClass}
          required
        />
      </Field>

      <Field label={t('password')} name="password" error={state.errors?.password?.[0]}>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
          className={inputClass}
          required
        />
      </Field>

      <Field
        label={t('confirmPassword')}
        name="passwordConfirm"
        error={state.errors?.passwordConfirm?.[0]}
      >
        <input
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          placeholder={t('confirmPasswordPlaceholder')}
          className={inputClass}
          required
        />
      </Field>

      {state.message && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ShieldCheck className="size-4" />
        )}
        {t('createAdmin')}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        {t('onlyAccessible')}
      </p>
    </form>
  );
}

const inputClass = cn(
  'w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm',
  'outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30',
);

function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </div>
  );
}
