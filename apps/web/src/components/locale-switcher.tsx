'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe } from 'lucide-react';
import { locales } from '@/i18n/config';
import { setLocale } from './locale-actions';

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('locale');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div className="relative flex items-center">
      <Globe className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <select
        value={locale}
        onChange={onChange}
        disabled={isPending}
        aria-label={t('switchLocale')}
        className="appearance-none rounded-md border border-border bg-background/50 py-1 pl-7 pr-6 text-xs text-foreground outline-none transition hover:bg-accent focus:ring-2 focus:ring-ring/30 disabled:opacity-50 cursor-pointer"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {t(loc)}
          </option>
        ))}
      </select>
    </div>
  );
}
