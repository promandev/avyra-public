'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function BackButton() {
  const pathname = usePathname();
  const t = useTranslations('common');

  if (pathname === '/dashboard') return null;

  return (
    <div className="border-b border-border/40 px-6 py-3">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t('back')}
      </Link>
    </div>
  );
}
