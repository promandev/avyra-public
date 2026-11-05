import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, HardDrive, Server, Vault } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import {
  getVaultBackupSummary,
  getVaultPublicUrl,
  getVaultServiceStatus,
  isVaultConfigured,
} from '@/lib/vault';
import { PageHeader } from '../_components/page-header';

export const dynamic = 'force-dynamic';

const BITWARDEN_DOWNLOADS = 'https://bitwarden.com/download/';

export async function generateMetadata() {
  const t = await getTranslations('vault');
  return { title: t('title') };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export default async function VaultPage() {
  const t = await getTranslations('vault');
  const format = await getFormatter();
  const publicUrl = getVaultPublicUrl();

  if (!isVaultConfigured() || !publicUrl) {
    return (
      <div className="container py-10">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <div className="glass flex flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center animate-scale-in">
          <Vault className="size-10 text-muted-foreground" />
          <p className="font-medium">{t('notConfigured')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t('notConfiguredHint')}</p>
        </div>
      </div>
    );
  }

  const [service, backups] = await Promise.all([getVaultServiceStatus(), getVaultBackupSummary()]);
  const steps = ['install', 'server', 'login', 'twoFactor', 'import'] as const;

  return (
    <div className="container py-10">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground shadow-primary/20 flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-lg transition hover:opacity-90"
          >
            {t('open')} <ExternalLink className="size-3.5" />
          </a>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="glass space-y-3 rounded-2xl p-5">
          <h2 className="flex items-center gap-2 font-medium">
            <Server className="size-4 text-muted-foreground" /> {t('service.title')}
          </h2>
          <p className="flex items-center gap-2 text-sm">
            <span className={`size-2 rounded-full ${service.online ? 'bg-emerald-500' : 'bg-destructive'}`} />
            {service.online ? t('service.online') : t('service.offline')}
          </p>
          {service.version && (
            <p className="text-sm text-muted-foreground">{t('service.version', { version: service.version })}</p>
          )}
          <p className="break-all text-sm text-muted-foreground">{publicUrl}</p>
          {!service.online && <Warning>{t('service.offlineHint')}</Warning>}
        </section>

        <section className="glass space-y-3 rounded-2xl p-5">
          <h2 className="flex items-center gap-2 font-medium">
            <HardDrive className="size-4 text-muted-foreground" /> {t('backups.title')}
          </h2>
          {!backups.available ? (
            <Warning>{t('backups.unavailable')}</Warning>
          ) : backups.latest ? (
            <>
              <p className="flex items-center gap-2 text-sm">
                {backups.stale ? (
                  <AlertTriangle className="size-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                )}
                {t('backups.latest', {
                  when: format.relativeTime(backups.latest.createdAt),
                  size: formatBytes(backups.latest.sizeBytes),
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('backups.kept', { count: backups.count, size: formatBytes(backups.totalBytes) })}
              </p>
              {backups.stale && <Warning>{t('backups.stale')}</Warning>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('backups.none')}</p>
          )}
          {backups.lastError && <Warning>{t('backups.lastError', { error: backups.lastError })}</Warning>}
          <p className="text-xs text-muted-foreground">{t('backups.offsiteHint')}</p>
        </section>
      </div>

      <section className="glass mt-4 rounded-2xl p-5">
        <h2 className="font-medium">{t('setup.title')}</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground marker:text-foreground">
          {steps.map((step) => (
            <li key={step}>
              {t.rich(`setup.${step}`, {
                url: publicUrl,
                b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
                link: (chunks) => (
                  <a
                    href={BITWARDEN_DOWNLOADS}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-4"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </li>
          ))}
        </ol>
      </section>

      <section className="glass mt-4 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-muted-foreground" /> {t('rules.title')}
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>{t('rules.distinct')}</li>
          <li>{t('rules.paper')}</li>
          <li>{t('rules.noRecovery')}</li>
        </ul>
      </section>
    </div>
  );
}
