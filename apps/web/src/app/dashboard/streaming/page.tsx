import { getTranslations } from 'next-intl/server';

import { isMinerConfigured } from '@/lib/twitch-miner';
import { PageHeader } from '../_components/page-header';
import { StreamingClient } from './_components/streaming-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('streaming');
  return { title: t('title') };
}

export default async function StreamingPage() {
  const t = await getTranslations('streaming');

  return (
    <div className="container py-10">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <StreamingClient configured={isMinerConfigured()} />
    </div>
  );
}
