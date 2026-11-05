'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { checkCredentials } from './actions';

export function LoginForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [totpDigits, setTotpDigits] = useState('');
  const totpInputRef = useRef<HTMLInputElement>(null);

  const formatTotpDisplay = (digits: string) => {
    const chars = Array.from({ length: 6 }, (_, i) => digits[i] ?? 'X');
    return chars.slice(0, 3).join('') + '-' + chars.slice(3).join('');
  };

  useEffect(() => {
    if (step !== 'totp') return;
    const el = totpInputRef.current;
    if (!el) return;
    const pos = totpDigits.length + (totpDigits.length >= 3 ? 1 : 0);
    el.setSelectionRange(pos, pos);
    if (totpDigits.length === 6) {
      totpForm.handleSubmit(onSubmitTotp)();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totpDigits, step]);

  // ── Step 1: email + password ──────────────────────────────────────────────
  const credSchema = z.object({
    email: z.string().email(t('invalidEmail')),
    password: z.string().min(8, t('minChars')),
  });
  type CredValues = z.infer<typeof credSchema>;

  const credForm = useForm<CredValues>({ resolver: zodResolver(credSchema) });

  const onSubmitCredentials = (values: CredValues) => {
    setError(null);
    startTransition(async () => {
      const result = await checkCredentials(values.email, values.password);
      if (!result.ok) {
        setError(result.error === 'locked' ? t('accountLocked') : t('wrongCredentials'));
        return;
      }
      setCreds(values);
      if (!result.needsTotp) {
        const res = await signIn('credentials', { ...values, totp: '', redirect: false });
        if (!res || res.error) { setError(t('loginFailed')); return; }
        window.location.href = '/dashboard';
      } else {
        setStep('totp');
      }
    });
  };

  // ── Step 2: TOTP ────────────────────────────────────────────────────
  const totpSchema = z.object({
    totp: z.string().regex(/^\d{6}$/, t('totpValidation')),
  });
  type TotpValues = z.infer<typeof totpSchema>;

  const totpForm = useForm<TotpValues>({ resolver: zodResolver(totpSchema), defaultValues: { totp: '' } });

  const onSubmitTotp = (values: TotpValues) => {
    setError(null);
    startTransition(async () => {
      const res = await signIn('credentials', { ...creds!, totp: values.totp, redirect: false });
      if (!res || res.error) { setError(t('wrongCredentials')); return; }
      window.location.href = '/dashboard';
    });
  };

  const onGoogle = () => signIn('google', { callbackUrl: '/dashboard' });

  // ── TOTP step render ────────────────────────────────────────────────
  if (step === 'totp') {
    return (
      <form onSubmit={totpForm.handleSubmit(onSubmitTotp)} className="space-y-4">
        <div className="mb-2 text-center space-y-1">
          <ShieldCheck className="mx-auto size-8 text-primary" />
          <p className="text-sm font-medium">{t('totpStep')}</p>
          <p className="text-xs text-muted-foreground">{t('totpStepDesc')}</p>
        </div>

        <Field label={t('totpLabel')} htmlFor="login-totp" error={totpForm.formState.errors.totp?.message}>
          <input
            id="login-totp"
            ref={totpInputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={formatTotpDisplay(totpDigits)}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
              setTotpDigits(raw);
              totpForm.setValue('totp', raw);
            }}
            onKeyDown={(e) => {
              // When cursor is right after the dash (pos 4) with 3 digits,
              // backspace would remove the dash and change nothing — handle it manually.
              if (e.key === 'Backspace' && totpDigits.length === 3) {
                const pos = totpInputRef.current?.selectionStart ?? 0;
                if (pos === 4) {
                  e.preventDefault();
                  const newDigits = totpDigits.slice(0, 2);
                  setTotpDigits(newDigits);
                  totpForm.setValue('totp', newDigits);
                }
              }
            }}
            onClick={() => {
              const el = totpInputRef.current;
              if (!el) return;
              const pos = totpDigits.length + (totpDigits.length >= 3 ? 1 : 0);
              el.setSelectionRange(pos, pos);
            }}
            onFocus={() => {
              const el = totpInputRef.current;
              if (!el) return;
              const pos = totpDigits.length + (totpDigits.length >= 3 ? 1 : 0);
              el.setSelectionRange(pos, pos);
            }}
            className={cn(inputClass, 'text-center font-mono tracking-widest text-base')}
          />
        </Field>

        {error && (
          <p role="alert" aria-live="polite" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
          {t('enter')}
        </button>

        <button
          type="button"
          onClick={() => { setStep('credentials'); setError(null); setTotpDigits(''); totpForm.reset(); }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
          {t('backToLogin')}
        </button>
      </form>
    );
  }

  // ── Credentials step render ────────────────────────────────────────────
  return (
    <form onSubmit={credForm.handleSubmit(onSubmitCredentials)} className="space-y-4">
      {googleEnabled && (
        <>
          <button
            type="button"
            onClick={onGoogle}
            className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition hover:bg-accent"
          >
            <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {t('signInWithGoogle')}
          </button>

          <div className="relative my-2 flex items-center">
            <div className="flex-grow border-t border-border" />
            <span className="mx-3 text-xs uppercase tracking-wider text-muted-foreground">{tc('or')}</span>
            <div className="flex-grow border-t border-border" />
          </div>
        </>
      )}

      <Field label={t('email')} htmlFor="login-email" error={credForm.formState.errors.email?.message}>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          {...credForm.register('email')}
          className={inputClass}
        />
      </Field>

      <Field label={t('password')} htmlFor="login-password" error={credForm.formState.errors.password?.message}>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          {...credForm.register('password')}
          className={inputClass}
        />
      </Field>

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
        {t('enter')}
      </button>
    </form>
  );
}

const inputClass = cn(
  'w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm',
  'outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30',
);

function Field({
  label,
  error,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="block space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </div>
  );
}
