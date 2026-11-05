import { getTranslations } from 'next-intl/server';

import { isHaConfigured } from '@/lib/shopping';
import { PageHeader } from '../_components/page-header';
import { ShoppingClient } from './_components/shopping-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('shopping');
  return { title: t('title') };
}

export default async function ShoppingPage() {
  const t = await getTranslations('shopping');

  return (
    <div className="container py-10">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <ShoppingClient configured={isHaConfigured()} />
    </div>
  );
}
