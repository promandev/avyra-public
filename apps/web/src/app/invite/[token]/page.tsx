import { getTranslations } from 'next-intl/server';
import { CheckCircle2, XCircle, LogIn, UserPlus } from 'lucide-react';

import { auth, signIn } from '@/lib/auth';
import { acceptInvite } from '@/app/dashboard/members/actions';
import { getInvitePreview } from './actions';
import { InviteRegisterForm } from './invite-register-form';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const t = await getTranslations('members');
  const session = await auth();

  // If not authenticated → registration form for new users, login options otherwise
  if (!session?.user?.id) {
    const preview = await getInvitePreview(token);

    if (preview.status !== 'ok') {
      return (
        <main className="container flex min-h-dvh items-center justify-center py-12">
          <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl space-y-4 text-center">
            <XCircle className="mx-auto size-10 text-destructive" />
            <h1 className="text-xl font-semibold">{t('inviteError')}</h1>
            <p className="text-sm text-muted-foreground">
              {preview.status === 'expired' ? t('inviteExpired') : t('inviteInvalid')}
            </p>
          </div>
        </main>
      );
    }

    // The invited email has no account yet → let them create one right here
    if (!preview.hasAccount) {
      return (
        <main className="container flex min-h-dvh items-center justify-center py-12">
          <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl space-y-6 text-center">
            <UserPlus className="mx-auto size-10 text-primary" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">{t('inviteTitle')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('inviteRegisterSubtitle', { household: preview.householdName })}
              </p>
            </div>
            <InviteRegisterForm token={token} email={preview.email} />
          </div>
        </main>
      );
    }

    const callbackUrl = `/invite/${token}`;

    const googleEnabled =
      !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

    const googleAction = async () => {
      'use server';
      await signIn('google', { redirectTo: callbackUrl });
    };

    return (
      <main className="container flex min-h-dvh items-center justify-center py-12">
        <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl space-y-6 text-center">
          <LogIn className="mx-auto size-10 text-primary" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">{t('inviteTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('loginToAccept')}</p>
          </div>

          <div className="space-y-3">
            {googleEnabled && (
              <form action={googleAction}>
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition hover:bg-accent"
                >
                  {/* Google SVG icon */}
                  <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  {t('signInWithGoogle')}
                </button>
              </form>
            )}

            <a
              href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90"
            >
              {t('signInWithEmail')}
            </a>
          </div>
        </div>
      </main>
    );
  }

  // User is authenticated → try to accept the invite
  const result = await acceptInvite(token);

  if (!result.ok) {
    const messages: Record<typeof result.error, string> = {
      invalid: t('inviteInvalid'),
      expired: t('inviteExpired'),
      alreadyMember: t('alreadyMember'),
      notAuthenticated: t('loginToAccept'),
      emailMismatch: t('inviteEmailMismatch'),
    };

    return (
      <main className="container flex min-h-dvh items-center justify-center py-12">
        <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl space-y-4 text-center">
          <XCircle className="mx-auto size-10 text-destructive" />
          <h1 className="text-xl font-semibold">{t('inviteError')}</h1>
          <p className="text-sm text-muted-foreground">{messages[result.error]}</p>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            {t('goToDashboard')}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="container flex min-h-dvh items-center justify-center py-12">
      <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-green-500" />
        <h1 className="text-xl font-semibold">{t('inviteAccepted')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('joinedAs', { household: result.householdName, role: result.role })}
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          {t('goToDashboard')}
        </a>
      </div>
    </main>
  );
}
