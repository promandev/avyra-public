import { getTranslations } from 'next-intl/server';

import { panelRoot } from '@/lib/system-panel';
import { PageHeader } from '../_components/page-header';
import { SystemClient } from './_components/system-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('system');
  return { title: t('title') };
}

export default async function SystemPage() {
  const t = await getTranslations('system');

  return (
    <div className="container py-10">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <SystemClient filesRoot={panelRoot()} />
    </div>
  );
}
