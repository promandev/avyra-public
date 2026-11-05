'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck, ShieldOff, Loader2, Copy, Check } from 'lucide-react';
import QRCode from 'react-qr-code';

import { initiateTotpSetup, confirmTotpSetup, disableTotp } from '../actions';

interface Props {
  totpEnabled: boolean;
}

type Step = 'idle' | 'setup' | 'enabled';

export function TotpSetup({ totpEnabled }: Props) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [step, setStep] = useState<Step>(totpEnabled ? 'enabled' : 'idle');
  const [setupData, setSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleInitiate() {
    startTransition(async () => {
      setError(null);
      const result = await initiateTotpSetup();
      if ('error' in result) { setError(result.error); return; }
      setSetupData(result);
      setStep('setup');
    });
  }

  function handleConfirm() {
    startTransition(async () => {
      setError(null);
      const result = await confirmTotpSetup(code);
      if ('error' in result) { setError(result.error); return; }
      setStep('enabled');
      setSetupData(null);
      setCode('');
    });
  }

  function handleDisable() {
    startTransition(async () => {
      setError(null);
      const result = await disableTotp(code);
      if ('error' in result) { setError(result.error); return; }
      setStep('idle');
      setCode('');
    });
  }

  function copySecret() {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const inputClass =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-ring/30';

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {step === 'enabled' ? (
            <ShieldCheck className="size-4 text-green-500" />
          ) : (
            <ShieldOff className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {step === 'enabled' ? t('totpEnabled') : t('totpDisabled')}
          </span>
        </div>
        {step === 'idle' && (
          <button
            onClick={handleInitiate}
            disabled={isPending}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="size-3 animate-spin" />}
            {t('totpActivateBtn')}
          </button>
        )}
      </div>

      {step === 'setup' && setupData && (
        <div className="space-y-4 border-t border-border pt-4">
          <p className="text-sm text-foreground/70">
            {t('totpSetupInstructions')}
          </p>
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
            <span className="flex-1 font-mono text-sm break-all">{setupData.secret}</span>
            <button onClick={copySecret} className="shrink-0 text-muted-foreground hover:text-foreground">
              {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-foreground/70">
            {' '}
            <a href={setupData.uri} className="underline">
              {t('totpOpenApp')}
            </a>
          </p>
          <div className="flex justify-center rounded-xl bg-white p-4">
            <QRCode value={setupData.uri} size={180} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">
              {t('totpCodeLabel')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={isPending || code.length !== 6}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="size-3 animate-spin" />}
              {t('totpVerifyBtn')}
            </button>
            <button
              onClick={() => { setStep('idle'); setSetupData(null); setCode(''); setError(null); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}

      {step === 'enabled' && (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs text-foreground/70">
            {t('totpDisableInstructions')}
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">{t('totpCurrentCode')}</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className={inputClass}
            />
          </div>
          <button
            onClick={handleDisable}
            disabled={isPending || code.length !== 6}
            className="flex items-center gap-2 rounded-md border border-destructive px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {isPending && <Loader2 className="size-3 animate-spin" />}
            {t('totpDisableBtn')}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
