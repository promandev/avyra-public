import { getTranslations } from 'next-intl/server';

import { isPrinterConfigured } from '@/lib/printer';
import { PageHeader } from '../_components/page-header';
import { PrinterClient } from './_components/printer-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('printer');
  return { title: t('title') };
}

export default async function PrinterPage() {
  const t = await getTranslations('printer');

  return (
    <div className="container py-10">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <PrinterClient configured={isPrinterConfigured()} />
    </div>
  );
}
