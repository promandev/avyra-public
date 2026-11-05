import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';

export default async function HomePage() {
  const session = await auth();
  if (session) redirect('/dashboard');

  const t = await getTranslations('home');
  const tc = await getTranslations('common');

  return (
    <main className="container flex min-h-dvh flex-col items-center justify-center gap-8 py-16 text-center">
      <div className="space-y-4">
        <p className="text-sm uppercase tracking-[0.4em] text-muted-foreground">{tc('appName')}</p>
        <h1 className="bg-gradient-to-br from-white to-primary bg-clip-text text-5xl font-semibold tracking-tight text-transparent sm:text-6xl">
          {t('tagline')}
        </h1>
        <p className="mx-auto max-w-xl text-balance text-muted-foreground">
          {t('description')}
        </p>
      </div>

      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90"
        >
          {t('access')}
        </Link>
      </div>
    </main>
  );
}
