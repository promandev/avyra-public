import { getTranslations } from 'next-intl/server';

import { PageHeader } from '../_components/page-header';
import { FinanceClient } from './_components/finance-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('finance');
  return { title: t('title') };
}

export default async function FinancePage() {
  const t = await getTranslations('finance');

  return (
    <div className="container py-10">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <FinanceClient />
    </div>
  );
}
