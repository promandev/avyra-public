import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb, users } from '@pradomotica/db';
import { getTranslations } from 'next-intl/server';

import { OnboardingForm } from './onboarding-form';
import { AvyraLogo } from '@/components/avyra-logo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('pageTitle') };
}

export default async function OnboardingPage() {
  const t = await getTranslations('onboarding');

  let hasUsers = false;
  try {
    const db = getDb();
    const [existing] = await db.select({ id: users.id }).from(users).limit(1);
    hasUsers = !!existing;
  } catch {
    // DB no disponible — continuamos mostrando el formulario.
  }
  if (hasUsers) redirect('/login');

  return (
    <main className="container flex min-h-dvh items-center justify-center py-12">
      <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl">
        <header className="mb-6 space-y-1 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center">
            <AvyraLogo variant="mark" markSize={44} markClassName="text-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('welcome')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('subtitle')}
          </p>
        </header>
        <OnboardingForm />
      </div>
    </main>
  );
}
