import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isDevAuthBypassEnabled } from '@/lib/auth';
import { LoginForm } from './login-form';
import { AvyraLogo } from '@/components/avyra-logo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('loginTitle') };
}

export default async function LoginPage() {
  if (isDevAuthBypassEnabled()) {
    redirect('/dashboard');
  }

  const t = await getTranslations('auth');
  const googleEnabled =
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

  return (
    <main className="container flex min-h-dvh items-center justify-center py-12">
      {/* Mismo halo de marca que el panel, sin los tonos de estado: aquí
          todavía no sabemos nada de la casa. */}
      <div className="ambient-root" aria-hidden="true">
        <div className="ambient-layer ambient-brand" />
        <div className="ambient-grain" />
      </div>

      <div className="surface-hero w-full max-w-md animate-scale-in p-8">
        <header
          className="mb-7 animate-fade-in-down space-y-3 text-center"
          style={{ animationDelay: '100ms' }}
        >
          <div className="mx-auto mb-4 flex w-fit items-center justify-center rounded-2xl bg-primary/10 p-3.5 shadow-[0_0_36px_-8px_hsl(var(--primary)/0.6)]">
            <AvyraLogo variant="mark" markSize={40} markClassName="text-primary" />
          </div>
          <AvyraLogo
            variant="wordmark"
            wordmarkClassName="text-muted-foreground text-[11px] font-medium"
          />
          <h1 className="text-display-sm font-semibold">{t('welcomeBack')}</h1>
          <p className="text-sm text-muted-foreground">{t('loginSubtitle')}</p>
        </header>
        <LoginForm googleEnabled={googleEnabled} />
      </div>
    </main>
  );
}
