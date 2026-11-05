'use client';

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  CircleDashed,
  Clock,
  History,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Undo2,
  Upload,
  Wallet,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import {
  DEBT_KINDS,
  type DebtInput,
  type DebtDetail,
  type DebtKind,
  type DebtView,
  type FinanceOverview,
  type ImportResult,
  type MonthSummary,
  type RecurringInput,
  type RecurringSuggestion,
  type RecurringView,
  type SeriesPoint,
  type TransactionView,
} from '@/lib/finance-types';

const TABS = ['summary', 'debts', 'fixed', 'movements', 'import'] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab =>
  value !== null && (TABS as readonly string[]).includes(value);

/** Pasado esto sin subir un extracto, la portada lo recuerda. */
const STALE_IMPORT_DAYS = 35;
const NOTICE_MS = 6_000;

type Notice = { kind: 'ok' | 'error'; text: string };
type Notify = (notice: Notice) => void;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  return data as T;
}

const sendJson = <T,>(url: string, method: 'POST' | 'PUT', body: unknown) =>
  request<T>(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// --------------------------------------------------------------------------- //
// Formato
// --------------------------------------------------------------------------- //

function useMoney() {
  const format = useFormatter();
  return useCallback(
    (cents: number, opts?: { sign?: boolean }) =>
      format.number(cents / 100, {
        style: 'currency',
        currency: 'EUR',
        signDisplay: opts?.sign ? 'exceptZero' : 'auto',
      }),
    [format],
  );
}

function useDates() {
  const format = useFormatter();
  return useMemo(
    () => ({
      // Sólo la primera letra: `capitalize` de CSS dejaría «Octubre De 2026».
      month: (ym: string) => {
        const text = format.dateTime(new Date(`${ym}-01T00:00:00Z`), { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return text.charAt(0).toUpperCase() + text.slice(1);
      },
      day: (iso: string) =>
        format.dateTime(new Date(`${iso}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
      shortDay: (iso: string) =>
        format.dateTime(new Date(`${iso}T00:00:00Z`), { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    }),
    [format],
  );
}

/**
 * Importe escrito a mano a céntimos. Acepta "232556,48", "232.556,48" y
 * "665.16". Vacío → null; ilegible → undefined.
 */
function parseEuros(input: string): number | null | undefined {
  const s = input.replace(/[€\s]/g, '');
  if (!s) return null;
  let normalized: string;
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(s)) normalized = s;
  else normalized = s.replace(/\./g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

const centsToInput = (cents: number | null) =>
  cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

/** Días de calendario entre dos fechas 'YYYY-MM-DD'. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 'YYYY-MM' de un <input type="month"> → último día de ese mes. */
function monthEnd(ym: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------- //
// Piezas comunes
// --------------------------------------------------------------------------- //

function Tile({ icon, title, value, detail }: { icon: ReactNode; title: string; value: string; detail?: ReactNode }) {
  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </section>
  );
}

/**
 * Etiqueta + control. La ayuda va aparte y enlazada con aria-describedby: si
 * estuviera dentro del <label> pasaría a formar parte del nombre del campo.
 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="text-sm">
      <label htmlFor={id} className="mb-1 block text-muted-foreground">
        {label}
      </label>
      {cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-describedby': hint ? hintId : undefined })}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground/80">
          {hint}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none transition focus:border-foreground/40';

const primaryButton =
  'inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

const ghostButton = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition hover:bg-accent/40';

function Progress({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Resumen
// --------------------------------------------------------------------------- //

function Summary({ data, onGoImport }: { data: FinanceOverview; onGoImport: () => void }) {
  const t = useTranslations('finance');
  const money = useMoney();
  const dates = useDates();
  const [selected, setSelected] = useState<string | null>(data.months[0]?.month ?? null);
  const month = data.months.find((m) => m.month === selected) ?? data.months[0] ?? null;

  const lastImport = data.imports[0];
  const daysSinceImport = lastImport ? daysBetween(lastImport.createdAt.slice(0, 10), data.today) : null;

  return (
    <div className="space-y-6">
      {(daysSinceImport === null || daysSinceImport > STALE_IMPORT_DAYS) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-state-heat/40 bg-state-heat/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <Clock className="size-4" />
            {daysSinceImport === null ? t('summary.noImports') : t('summary.staleImport', { days: daysSinceImport })}
          </span>
          <button type="button" onClick={onGoImport} className={primaryButton}>
            <Upload className="size-4" />
            {t('summary.goImport')}
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<Wallet className="size-4" />}
          title={t('summary.balance')}
          value={data.latestBalance ? money(data.latestBalance.cents) : '—'}
          detail={data.latestBalance ? t('summary.balanceAt', { date: dates.day(data.latestBalance.date) }) : t('summary.noData')}
        />
        <Tile
          icon={<Landmark className="size-4" />}
          title={t('summary.totalDebt')}
          value={money(data.totalDebtCents)}
          detail={t('summary.debtCount', { count: data.debts.length })}
        />
        <Tile
          icon={<Receipt className="size-4" />}
          title={t('summary.fixedMonthly')}
          value={money(data.monthlyFixedCents)}
          detail={t('summary.fixedMonthlyHint')}
        />
        <Tile
          icon={<CalendarClock className="size-4" />}
          title={t('summary.fixedIncome')}
          value={data.monthlyFixedIncomeCents ? money(data.monthlyFixedIncomeCents) : '—'}
          detail={
            data.monthlyFixedIncomeCents
              ? t('summary.leftAfterFixed', { amount: money(data.monthlyFixedIncomeCents - data.monthlyFixedCents) })
              : t('summary.fixedIncomeHint')
          }
        />
      </div>

      {month ? (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('summary.months')}>
            {data.months.map((m) => (
              <button
                key={m.month}
                type="button"
                onClick={() => setSelected(m.month)}
                aria-pressed={m.month === month.month}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  m.month === month.month
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border/60 hover:bg-accent/40'
                }`}
              >
                {dates.month(m.month)}
              </button>
            ))}
          </div>

          <MonthDetail month={month} />
          <MonthsTable months={data.months} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('summary.noData')}</p>
      )}
    </div>
  );
}

function MonthDetail({ month }: { month: MonthSummary }) {
  const t = useTranslations('finance');
  const money = useMoney();
  const dates = useDates();
  const top = month.categories.slice(0, 10);
  const max = top[0]?.cents ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="glass rounded-2xl p-5">
        <h3 className="text-sm font-medium">
          {dates.month(month.month)}
          {month.partial && <span className="ml-2 text-xs font-normal text-muted-foreground">{t('summary.partial')}</span>}
        </h3>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t('summary.income')}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money(month.incomeCents)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('summary.expenses')}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money(month.expenseCents)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('summary.net')}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${month.netCents < 0 ? 'text-destructive' : ''}`}>
              {money(month.netCents, { sign: true })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('summary.fixedSpent')}</dt>
            <dd className="tabular-nums">{money(month.fixedCents)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('summary.variableSpent')}</dt>
            <dd className="tabular-nums">{money(month.variableCents)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('summary.movements')}</dt>
            <dd className="tabular-nums">{month.count}</dd>
          </div>
        </dl>

        <h4 className="mt-6 text-sm font-medium">{t('summary.fixedStatus')}</h4>
        {month.fixed.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('summary.noFixedRules')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/40 text-sm">
            {month.fixed.map((f) => (
              <li key={`${f.ref.kind}-${f.ref.id}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  {f.actualCents !== null ? (
                    <Check className="size-4 shrink-0 text-state-live" aria-label={t('summary.paid')} />
                  ) : (
                    <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-label={t('summary.pending')} />
                  )}
                  <span className="truncate">{f.name}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {f.actualCents !== null ? (
                    <>
                      {money(f.actualCents)}
                      <span className="ml-2 text-xs text-muted-foreground">{dates.shortDay(f.date!)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('summary.pending')} · {money(f.expectedCents)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <h3 className="text-sm font-medium">{t('summary.byCategory')}</h3>
        {top.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('summary.noExpenses')}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {top.map((c) => (
              <li key={c.name} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{c.name === '—' ? t('summary.uncategorized') : c.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {money(c.cents)}
                    <span className="ml-2 text-xs">{Math.round((c.cents / month.expenseCents) * 100)} %</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${max ? (c.cents / max) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MonthsTable({ months }: { months: MonthSummary[] }) {
  const t = useTranslations('finance');
  const money = useMoney();
  const dates = useDates();
  return (
    <section className="glass overflow-x-auto rounded-2xl p-5">
      <h3 className="text-sm font-medium">{t('summary.evolution')}</h3>
      <table className="mt-3 w-full min-w-[520px] text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 font-normal">{t('summary.month')}</th>
            <th className="py-2 text-right font-normal">{t('summary.income')}</th>
            <th className="py-2 text-right font-normal">{t('summary.fixedSpent')}</th>
            <th className="py-2 text-right font-normal">{t('summary.variableSpent')}</th>
            <th className="py-2 text-right font-normal">{t('summary.net')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {months.map((m) => (
            <tr key={m.month}>
              <td className="py-2">
                {dates.month(m.month)}
                {m.partial && <span className="ml-1 text-xs text-muted-foreground">*</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{money(m.incomeCents)}</td>
              <td className="py-2 text-right tabular-nums">{money(m.fixedCents)}</td>
              <td className="py-2 text-right tabular-nums">{money(m.variableCents)}</td>
              <td className={`py-2 text-right font-medium tabular-nums ${m.netCents < 0 ? 'text-destructive' : ''}`}>
                {money(m.netCents, { sign: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {months.some((m) => m.partial) && <p className="mt-2 text-xs text-muted-foreground">* {t('summary.partialHint')}</p>}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Deudas
// --------------------------------------------------------------------------- //

interface DebtDraft {
  name: string;
  lender: string;
  kind: DebtKind;
  balance: string;
  balanceAsOf: string;
  payment: string;
  paymentDay: string;
  rate: string;
  endMonth: string;
  reviewMonth: string;
  matchText: string;
  matchAmount: string;
  notes: string;
}

function debtDraft(debt: DebtView | null, today: string): DebtDraft {
  return {
    name: debt?.name ?? '',
    lender: debt?.lender ?? '',
    kind: debt?.kind ?? 'loan',
    balance: centsToInput(debt?.balanceCents ?? null),
    balanceAsOf: debt?.balanceAsOf ?? today,
    payment: centsToInput(debt?.monthlyPaymentCents ?? null),
    paymentDay: debt?.paymentDay ? String(debt.paymentDay) : '',
    rate: debt?.annualRate !== null && debt?.annualRate !== undefined ? String(debt.annualRate).replace('.', ',') : '',
    endMonth: debt?.endDate?.slice(0, 7) ?? '',
    reviewMonth: debt?.rateReviewDate?.slice(0, 7) ?? '',
    matchText: debt?.matchText ?? '',
    matchAmount: centsToInput(debt?.matchAmountCents ?? null),
    notes: debt?.notes ?? '',
  };
}

function DebtForm({
  debt,
  today,
  onDone,
  notify,
}: {
  debt: DebtView | null;
  today: string;
  onDone: (saved: boolean) => void;
  notify: Notify;
}) {
  const t = useTranslations('finance');
  const [draft, setDraft] = useState(() => debtDraft(debt, today));
  const [saving, setSaving] = useState(false);
  const set = (key: keyof DebtDraft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const balance = parseEuros(draft.balance);
    const payment = parseEuros(draft.payment);
    const matchAmount = parseEuros(draft.matchAmount);
    const rate = draft.rate.trim() ? Number(draft.rate.replace(',', '.')) : null;
    const day = draft.paymentDay.trim() ? Number(draft.paymentDay) : null;
    if (balance === undefined || payment === undefined || payment === null || matchAmount === undefined) {
      notify({ kind: 'error', text: t('form.invalidAmount') });
      return;
    }
    if ((rate !== null && !Number.isFinite(rate)) || (day !== null && !(day >= 1 && day <= 31))) {
      notify({ kind: 'error', text: t('form.invalidNumber') });
      return;
    }
    const body: DebtInput = {
      name: draft.name,
      lender: draft.lender || null,
      kind: draft.kind,
      balanceCents: balance,
      balanceAsOf: draft.balanceAsOf,
      monthlyPaymentCents: payment,
      paymentDay: day,
      annualRate: rate,
      endDate: monthEnd(draft.endMonth),
      rateReviewDate: draft.reviewMonth ? `${draft.reviewMonth}-01` : null,
      matchText: draft.matchText || null,
      matchAmountCents: matchAmount,
      notes: draft.notes || null,
    };
    setSaving(true);
    try {
      if (debt) await sendJson(`/api/finance/debts/${debt.id}`, 'PUT', body);
      else await sendJson('/api/finance/debts', 'POST', body);
      notify({ kind: 'ok', text: t('form.saved') });
      onDone(true);
    } catch (err) {
      notify({ kind: 'error', text: t('error', { reason: (err as Error).message }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass space-y-4 rounded-2xl p-5">
      <h3 className="text-sm font-medium">{debt ? t('debts.edit') : t('debts.add')}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('debts.name')}>
          <input required maxLength={80} value={draft.name} onChange={set('name')} className={inputClass} placeholder={t('debts.namePlaceholder')} />
        </Field>
        <Field label={t('debts.kind')}>
          <select value={draft.kind} onChange={set('kind')} className={inputClass}>
            {DEBT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`debts.kinds.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('debts.lender')}>
          <input maxLength={80} value={draft.lender} onChange={set('lender')} className={inputClass} />
        </Field>
        <Field label={t('debts.balance')} hint={t('debts.balanceHint')}>
          <input inputMode="decimal" value={draft.balance} onChange={set('balance')} className={inputClass} placeholder="0,00" />
        </Field>
        <Field label={t('debts.balanceAsOf')}>
          <input type="date" required value={draft.balanceAsOf} onChange={set('balanceAsOf')} className={inputClass} />
        </Field>
        <Field label={t('debts.payment')} hint={t('debts.paymentHint')}>
          <input required inputMode="decimal" value={draft.payment} onChange={set('payment')} className={inputClass} placeholder="0,00" />
        </Field>
        <Field label={t('debts.paymentDay')}>
          <input type="number" min={1} max={31} value={draft.paymentDay} onChange={set('paymentDay')} className={inputClass} placeholder="1" />
        </Field>
        <Field label={t('debts.rate')} hint={t('debts.rateHint')}>
          <input inputMode="decimal" value={draft.rate} onChange={set('rate')} className={inputClass} />
        </Field>
        <Field label={t('debts.endMonth')}>
          <input type="month" value={draft.endMonth} onChange={set('endMonth')} className={inputClass} />
        </Field>
        <Field label={t('debts.reviewMonth')} hint={t('debts.reviewHint')}>
          <input type="month" value={draft.reviewMonth} onChange={set('reviewMonth')} className={inputClass} />
        </Field>
        <Field label={t('debts.matchText')} hint={t('debts.matchTextHint')}>
          <input maxLength={120} value={draft.matchText} onChange={set('matchText')} className={inputClass} />
        </Field>
        <Field label={t('debts.matchAmount')} hint={t('debts.matchAmountHint')}>
          <input inputMode="decimal" value={draft.matchAmount} onChange={set('matchAmount')} className={inputClass} placeholder="0,00" />
        </Field>
      </div>
      <Field label={t('debts.notes')}>
        <textarea maxLength={500} rows={2} value={draft.notes} onChange={set('notes')} className={inputClass} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(false)} className={ghostButton}>
          {t('form.cancel')}
        </button>
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('form.save')}
        </button>
      </div>
    </form>
  );
}

function DebtCard({
  debt,
  onOpen,
  onEdit,
  onDelete,
}: {
  debt: DebtView;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('finance');
  const format = useFormatter();
  const money = useMoney();
  const dates = useDates();
  const p = debt.projection;
  const l = debt.ledger;
  const outstanding = p.currentBalanceCents ?? p.remainingToPayCents;

  return (
    <section className="glass flex flex-col rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{debt.name}</h3>
          <p className="text-xs text-muted-foreground">
            {t(`debts.kinds.${debt.kind}`)}
            {debt.lender && ` · ${debt.lender}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onEdit} aria-label={t('debts.edit')} className="rounded-md p-1.5 transition hover:bg-accent/40">
            <Pencil className="size-4" />
          </button>
          <button type="button" onClick={onDelete} aria-label={t('debts.delete')} className="rounded-md p-1.5 transition hover:bg-accent/40">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <p className="mt-3 text-3xl font-semibold tabular-nums">{outstanding !== null ? money(outstanding) : '—'}</p>
      <p className="text-xs text-muted-foreground">
        {p.currentBalanceCents !== null ? t('debts.outstandingToday') : t('debts.outstandingPayments')}
      </p>
      {p.paidPercent !== null && p.paidPercent > 0 && <Progress percent={p.paidPercent} label={t('debts.paidSince')} />}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('debts.payment')}</dt>
        <dd className="text-right tabular-nums">
          {money(debt.monthlyPaymentCents)}
          {debt.matchAmountCents !== null && debt.matchAmountCents !== debt.monthlyPaymentCents && (
            <span className="block text-xs text-muted-foreground">{t('debts.chargedAs', { amount: money(debt.matchAmountCents) })}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">{t('debts.rate')}</dt>
        <dd className="text-right tabular-nums">
          {p.rateUsed === null
            ? t('debts.rateUnknown')
            : p.rateUsed === 0
              ? t('debts.noRate')
              : `${format.number(p.rateUsed, { maximumFractionDigits: 3 })} %`}
          {p.rateInferred && <span className="block text-xs text-muted-foreground">{t('debts.rateInferred')}</span>}
        </dd>
        <dt className="text-muted-foreground">{t('debts.paymentsLeft')}</dt>
        <dd className="text-right tabular-nums">{p.paymentsLeft ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('debts.projectedEnd')}</dt>
        <dd className="text-right">{p.projectedEnd ? dates.month(p.projectedEnd) : '—'}</dd>
        <dt className="text-muted-foreground">{t('debts.lastPayment')}</dt>
        <dd className="text-right tabular-nums">
          {l.lastPayment ? `${money(l.lastPayment.cents)} · ${dates.shortDay(l.lastPayment.date)}` : '—'}
        </dd>
      </dl>

      {l.missedMonths.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t('debts.missed', { count: l.missedMonths.length, months: l.missedMonths.map(dates.month).join(', ') })}
        </p>
      )}
      {p.neverEnds && (
        <p className="mt-3 flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t('debts.neverEnds')}
        </p>
      )}
      {p.reviewInMonths !== null && debt.rateReviewDate && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-state-heat/10 px-2.5 py-2 text-xs">
          <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
          {t('debts.review', { date: dates.month(debt.rateReviewDate.slice(0, 7)), months: p.reviewInMonths })}
        </p>
      )}
      {!debt.matchText && <p className="mt-3 text-xs text-muted-foreground">{t('debts.noMatch')}</p>}

      <div className="mt-auto pt-4">
        <button type="button" onClick={onOpen} className={`${ghostButton} -ml-3`}>
          <History className="size-4" />
          {t('debts.openHistory', { count: l.paymentsCount })}
        </button>
      </div>
    </section>
  );
}

/**
 * Pendiente a lo largo del tiempo: trazo continuo para lo pasado (según los
 * pagos) y discontinuo para lo previsto. Una sola serie, así que el mismo color
 * con el trazo como diferencia; la tabla de pagos hace de vista en tabla.
 */
function BalanceChart({ points, today }: { points: SeriesPoint[]; today: string }) {
  const t = useTranslations('finance');
  const format = useFormatter();
  const dates = useDates();
  const money = useMoney();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) return null;

  const W = 720;
  const H = 240;
  const pad = { top: 16, right: 16, bottom: 28, left: 64 };
  const xs = points.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...points.map((p) => p.balanceCents)) || 1;
  const x = (v: number) => pad.left + ((v - minX) / (maxX - minX || 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - v / maxY) * (H - pad.top - pad.bottom);
  const compact = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 0 });

  const realIdx = points.map((p, i) => (p.kind === 'real' ? i : -1)).filter((i) => i >= 0);
  const lastReal = realIdx.at(-1) ?? 0;
  const path = (idx: number[]) => idx.map((i, n) => `${n ? 'L' : 'M'}${x(xs[i]!).toFixed(1)},${y(points[i]!.balanceCents).toFixed(1)}`).join('');
  const realPath = path(realIdx);
  const projectedIdx = [lastReal, ...points.map((p, i) => (p.kind === 'projected' && i > lastReal ? i : -1)).filter((i) => i >= 0)];
  const projectedPath = projectedIdx.length > 1 ? path(projectedIdx) : '';
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxY * f));
  const todayX = x(Date.parse(`${today}T00:00:00Z`));
  const years = [...new Set(xs.map((v) => new Date(v).getUTCFullYear()))];
  const step = Math.max(1, Math.ceil(years.length / 6));
  const yearTicks = years.filter((_, i) => i % step === 0);

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(x(xs[i]!) - px) < Math.abs(x(xs[best]!) - px)) best = i;
    setHover(best);
  };

  const h = hover !== null ? points[hover]! : null;

  return (
    <figure className="glass rounded-2xl p-5">
      <figcaption className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-medium">{t('debts.chartTitle')}</span>
        <span className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <svg width="20" height="4" aria-hidden><line x1="0" y1="2" x2="20" y2="2" stroke="hsl(var(--primary))" strokeWidth="2" /></svg>
            {t('debts.chartReal')}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="20" height="4" aria-hidden><line x1="0" y1="2" x2="20" y2="2" stroke="hsl(var(--primary))" strokeWidth="2" strokeDasharray="4 3" /></svg>
            {t('debts.chartProjected')}
          </span>
        </span>
      </figcaption>
      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('debts.chartTitle')}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} stroke="hsl(var(--border))" strokeOpacity="0.6" />
              <text x={pad.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
                {compact(v)}
              </text>
            </g>
          ))}
          {yearTicks.map((yr) => {
            const v = Date.UTC(yr, 0, 1);
            if (v < minX || v > maxX) return null;
            return (
              <text key={yr} x={x(v)} y={H - 8} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
                {yr}
              </text>
            );
          })}
          {todayX >= pad.left && todayX <= W - pad.right && (
            <line x1={todayX} x2={todayX} y1={pad.top} y2={H - pad.bottom} stroke="hsl(var(--muted-foreground))" strokeOpacity="0.4" strokeDasharray="2 3" />
          )}
          {realPath && <path d={realPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />}
          {projectedPath && (
            <path d={projectedPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
          )}
          {h && (
            <>
              <line x1={x(xs[hover!]!)} x2={x(xs[hover!]!)} y1={pad.top} y2={H - pad.bottom} stroke="hsl(var(--foreground))" strokeOpacity="0.3" />
              <circle cx={x(xs[hover!]!)} cy={y(h.balanceCents)} r="5" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth="2" />
            </>
          )}
          <rect
            x={pad.left}
            y={pad.top}
            width={W - pad.left - pad.right}
            height={H - pad.top - pad.bottom}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-border/60 bg-background/95 px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${(x(xs[hover!]!) / W) * 100}%`,
              transform: x(xs[hover!]!) > W / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
            }}
          >
            <p className="text-muted-foreground">
              {h.kind === 'real' ? dates.day(h.date) : dates.month(h.date.slice(0, 7))} ·{' '}
              {h.kind === 'real' ? t('debts.chartReal') : t('debts.chartProjected')}
            </p>
            <p className="font-medium tabular-nums">{money(h.balanceCents)}</p>
          </div>
        )}
      </div>
    </figure>
  );
}

function DebtDetailView({ id, today, onBack }: { id: string; today: string; onBack: () => void }) {
  const t = useTranslations('finance');
  const money = useMoney();
  const dates = useDates();
  const [detail, setDetail] = useState<DebtDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<DebtDetail>(`/api/finance/debts/${id}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <button type="button" onClick={onBack} className={`${ghostButton} -ml-3`}>
      <ArrowLeft className="size-4" />
      {t('debts.backToList')}
    </button>
  );

  if (!detail) {
    return (
      <div className="space-y-4">
        {back}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {error ? <AlertTriangle className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
          {error ? t('error', { reason: error }) : t('loading')}
        </p>
      </div>
    );
  }

  const { debt, rows, series } = detail;
  const p = debt.projection;
  const l = debt.ledger;
  const known = debt.balanceCents !== null;
  const newestFirst = [...rows].reverse();

  return (
    <div className="space-y-6">
      {back}
      <div>
        <h3 className="text-xl font-semibold">{debt.name}</h3>
        <p className="text-sm text-muted-foreground">
          {t(`debts.kinds.${debt.kind}`)}
          {debt.lender && ` · ${debt.lender}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<Landmark className="size-4" />}
          title={known ? t('debts.outstandingToday') : t('debts.outstandingPayments')}
          value={money(p.currentBalanceCents ?? p.remainingToPayCents ?? 0)}
          detail={p.projectedEnd ? t('debts.endsIn', { date: dates.month(p.projectedEnd), count: p.paymentsLeft ?? 0 }) : undefined}
        />
        <Tile
          icon={<Check className="size-4" />}
          title={t('debts.paidTotal')}
          value={money(l.paidCents)}
          detail={t('debts.paidCount', { count: l.paymentsCount })}
        />
        {known && (
          <Tile
            icon={<Receipt className="size-4" />}
            title={t('debts.paidSplit')}
            value={money(l.principalPaidCents ?? 0)}
            detail={t('debts.paidInterest', { amount: money(l.interestPaidCents ?? 0) })}
          />
        )}
        {known && p.remainingInterestCents !== null && (
          <Tile
            icon={<CalendarClock className="size-4" />}
            title={t('debts.remainingInterest')}
            value={money(p.remainingInterestCents)}
            detail={p.remainingToPayCents !== null ? t('debts.remainingTotal', { amount: money(p.remainingToPayCents) }) : undefined}
          />
        )}
      </div>

      <div className="space-y-2 text-sm">
        {l.coverage && (
          <p className="text-muted-foreground">
            {t('debts.coverage', { from: dates.day(l.coverage.from), to: dates.day(l.coverage.to) })}
          </p>
        )}
        {l.estimatedPayments > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-state-heat/10 px-3 py-2">
            <Clock className="mt-0.5 size-4 shrink-0" />
            {t('debts.estimated', { count: l.estimatedPayments })}
          </p>
        )}
        {l.missedMonths.length > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t('debts.missed', { count: l.missedMonths.length, months: l.missedMonths.map(dates.month).join(', ') })}
          </p>
        )}
        {p.reviewInMonths !== null && debt.rateReviewDate && (
          <p className="flex items-start gap-2 rounded-md bg-state-heat/10 px-3 py-2">
            <CalendarClock className="mt-0.5 size-4 shrink-0" />
            {t('debts.review', { date: dates.month(debt.rateReviewDate.slice(0, 7)), months: p.reviewInMonths })}
          </p>
        )}
      </div>

      {known && <BalanceChart points={series} today={today} />}

      <section className="glass overflow-x-auto rounded-2xl p-2 sm:p-4">
        <h3 className="px-2 pt-2 text-sm font-medium">{t('debts.history')}</h3>
        {newestFirst.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{debt.matchText ? t('debts.noPayments') : t('debts.noMatch')}</p>
        ) : (
          <table className="mt-2 w-full min-w-[620px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-normal">{t('movements.date')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('debts.charged')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('debts.toDebt')}</th>
                {known && <th className="px-2 py-2 text-right font-normal">{t('debts.interest')}</th>}
                {known && <th className="px-2 py-2 text-right font-normal">{t('debts.principal')}</th>}
                {known && <th className="px-2 py-2 text-right font-normal">{t('debts.balanceAfter')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {newestFirst.map((row) => (
                <tr key={`${row.date}-${row.kind}`} className={row.kind === 'estimated' ? 'text-muted-foreground' : ''}>
                  <td className="whitespace-nowrap px-2 py-2">
                    {dates.day(row.date)}
                    {row.kind === 'estimated' && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{t('debts.estimatedTag')}</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(row.chargedCents)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(row.debtCents)}</td>
                  {known && <td className="px-2 py-2 text-right tabular-nums">{money(row.interestCents ?? 0)}</td>}
                  {known && <td className="px-2 py-2 text-right tabular-nums">{money(row.principalCents ?? 0)}</td>}
                  {known && <td className="px-2 py-2 text-right font-medium tabular-nums">{money(row.balanceAfterCents ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-2 pb-2 pt-3 text-xs text-muted-foreground">{t('debts.historyHint')}</p>
      </section>

      {debt.notes && <p className="whitespace-pre-line text-sm text-muted-foreground">{debt.notes}</p>}
      <p className="text-xs text-muted-foreground/80">{t('debts.snapshot', { date: dates.day(debt.balanceAsOf) })}</p>
    </div>
  );
}

function Debts({ data, reload, notify }: { data: FinanceOverview; reload: () => Promise<void>; notify: Notify }) {
  const t = useTranslations('finance');
  const [editing, setEditing] = useState<DebtView | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const remove = async (debt: DebtView) => {
    if (!window.confirm(t('debts.confirmDelete', { name: debt.name }))) return;
    try {
      await request(`/api/finance/debts/${debt.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      notify({ kind: 'error', text: t('error', { reason: (err as Error).message }) });
    }
  };

  const done = async (saved: boolean) => {
    setEditing(null);
    if (saved) await reload();
  };

  if (viewing && data.debts.some((d) => d.id === viewing)) {
    return <DebtDetailView id={viewing} today={data.today} onBack={() => setViewing(null)} />;
  }

  return (
    <div className="space-y-4">
      {editing === null && (
        <button type="button" onClick={() => setEditing('new')} className={primaryButton}>
          <Plus className="size-4" />
          {t('debts.add')}
        </button>
      )}
      {editing !== null && (
        <DebtForm
          key={editing === 'new' ? 'new' : editing.id}
          debt={editing === 'new' ? null : editing}
          today={data.today}
          onDone={(saved) => void done(saved)}
          notify={notify}
        />
      )}
      {data.debts.length === 0 && editing === null && <p className="text-sm text-muted-foreground">{t('debts.empty')}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.debts.map((d) => (
          <DebtCard
            key={d.id}
            debt={d}
            onOpen={() => setViewing(d.id)}
            onEdit={() => setEditing(d)}
            onDelete={() => void remove(d)}
          />
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Pagos fijos
// --------------------------------------------------------------------------- //

interface RecurringDraft {
  name: string;
  direction: 'expense' | 'income';
  amount: string;
  day: string;
  matchText: string;
  exact: boolean;
  active: boolean;
}

function recurringDraft(item: RecurringView | RecurringSuggestion | null): RecurringDraft {
  const amount = item?.amountCents ?? 0;
  return {
    name: item?.name ?? '',
    direction: amount > 0 ? 'income' : 'expense',
    amount: item ? centsToInput(Math.abs(amount)) : '',
    day: item && 'dayOfMonth' in item && item.dayOfMonth ? String(item.dayOfMonth) : '',
    matchText: item?.matchText ?? '',
    exact: item?.matchAmountCents !== null && item?.matchAmountCents !== undefined,
    active: item && 'active' in item ? item.active : true,
  };
}

function RecurringForm({
  item,
  onDone,
  notify,
}: {
  item: { existing: RecurringView } | { suggestion: RecurringSuggestion } | null;
  onDone: (saved: boolean) => void;
  notify: Notify;
}) {
  const t = useTranslations('finance');
  const existing = item && 'existing' in item ? item.existing : null;
  const [draft, setDraft] = useState(() =>
    recurringDraft(existing ?? (item && 'suggestion' in item ? item.suggestion : null)),
  );
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseEuros(draft.amount);
    const day = draft.day.trim() ? Number(draft.day) : null;
    if (amount === undefined || amount === null) {
      notify({ kind: 'error', text: t('form.invalidAmount') });
      return;
    }
    if (day !== null && !(day >= 1 && day <= 31)) {
      notify({ kind: 'error', text: t('form.invalidNumber') });
      return;
    }
    const body: RecurringInput = {
      name: draft.name,
      amountCents: draft.direction === 'expense' ? -amount : amount,
      dayOfMonth: day,
      matchText: draft.matchText || null,
      matchAmountCents: draft.exact ? amount : null,
      active: draft.active,
    };
    setSaving(true);
    try {
      if (existing) await sendJson(`/api/finance/recurring/${existing.id}`, 'PUT', body);
      else await sendJson('/api/finance/recurring', 'POST', body);
      notify({ kind: 'ok', text: t('form.saved') });
      onDone(true);
    } catch (err) {
      notify({ kind: 'error', text: t('error', { reason: (err as Error).message }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass space-y-4 rounded-2xl p-5">
      <h3 className="text-sm font-medium">{existing ? t('fixed.edit') : t('fixed.add')}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('fixed.name')}>
          <input required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('fixed.direction')}>
          <select
            value={draft.direction}
            onChange={(e) => setDraft({ ...draft, direction: e.target.value as RecurringDraft['direction'] })}
            className={inputClass}
          >
            <option value="expense">{t('fixed.expense')}</option>
            <option value="income">{t('fixed.income')}</option>
          </select>
        </Field>
        <Field label={t('fixed.amount')}>
          <input required inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className={inputClass} placeholder="0,00" />
        </Field>
        <Field label={t('fixed.day')}>
          <input type="number" min={1} max={31} value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('debts.matchText')} hint={t('debts.matchTextHint')}>
          <input maxLength={120} value={draft.matchText} onChange={(e) => setDraft({ ...draft, matchText: e.target.value })} className={inputClass} />
        </Field>
        <div className="space-y-2 pt-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.exact} onChange={(e) => setDraft({ ...draft, exact: e.target.checked })} />
            {t('fixed.exact')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            {t('fixed.active')}
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(false)} className={ghostButton}>
          {t('form.cancel')}
        </button>
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('form.save')}
        </button>
      </div>
    </form>
  );
}

function Fixed({ data, reload, notify }: { data: FinanceOverview; reload: () => Promise<void>; notify: Notify }) {
  const t = useTranslations('finance');
  const money = useMoney();
  type Editing = { existing: RecurringView } | { suggestion: RecurringSuggestion } | 'new' | null;
  const [editing, setEditing] = useState<Editing>(null);

  const remove = async (item: RecurringView) => {
    if (!window.confirm(t('fixed.confirmDelete', { name: item.name }))) return;
    try {
      await request(`/api/finance/recurring/${item.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      notify({ kind: 'error', text: t('error', { reason: (err as Error).message }) });
    }
  };

  const done = async (saved: boolean) => {
    setEditing(null);
    if (saved) await reload();
  };

  const formKey =
    editing === null || editing === 'new'
      ? 'new'
      : 'existing' in editing
        ? editing.existing.id
        : `s-${editing.suggestion.matchText}-${editing.suggestion.amountCents}`;

  return (
    <div className="space-y-6">
      {editing === null ? (
        <button type="button" onClick={() => setEditing('new')} className={primaryButton}>
          <Plus className="size-4" />
          {t('fixed.add')}
        </button>
      ) : (
        <RecurringForm key={formKey} item={editing === 'new' ? null : editing} onDone={(s) => void done(s)} notify={notify} />
      )}

      <section className="glass rounded-2xl p-5">
        <h3 className="text-sm font-medium">{t('fixed.title')}</h3>
        <ul className="mt-2 divide-y divide-border/40 text-sm">
          {data.debts.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate">{d.name}</span>
                <span className="text-xs text-muted-foreground">{t('fixed.fromDebt')}</span>
              </span>
              <span className="shrink-0 tabular-nums">{money(-(d.matchAmountCents ?? d.monthlyPaymentCents))}</span>
            </li>
          ))}
          {data.recurring.map((r) => (
            <li key={r.id} className={`flex items-center justify-between gap-3 py-2.5 ${r.active ? '' : 'opacity-50'}`}>
              <span className="min-w-0">
                <span className="block truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[
                    r.dayOfMonth ? t('fixed.onDay', { day: r.dayOfMonth }) : null,
                    r.matchText ? null : t('fixed.noMatch'),
                    r.active ? null : t('fixed.inactive'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="mr-2 tabular-nums">{money(r.amountCents)}</span>
                <button type="button" onClick={() => setEditing({ existing: r })} aria-label={t('fixed.edit')} className="rounded-md p-1.5 transition hover:bg-accent/40">
                  <Pencil className="size-4" />
                </button>
                <button type="button" onClick={() => void remove(r)} aria-label={t('fixed.delete')} className="rounded-md p-1.5 transition hover:bg-accent/40">
                  <Trash2 className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        {data.debts.length + data.recurring.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t('fixed.empty')}</p>}
        <p className="mt-3 flex justify-between border-t border-border/60 pt-3 text-sm font-medium">
          <span>{t('summary.fixedMonthly')}</span>
          <span className="tabular-nums">{money(data.monthlyFixedCents)}</span>
        </p>
      </section>

      {data.suggestions.length > 0 && (
        <section className="glass rounded-2xl p-5">
          <h3 className="text-sm font-medium">{t('fixed.suggestions')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('fixed.suggestionsHint')}</p>
          <ul className="mt-2 divide-y divide-border/40 text-sm">
            {data.suggestions.map((s) => (
              <li key={`${s.matchText}-${s.amountCents}`} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('fixed.seenMonths', { count: s.months })}
                    {s.matchAmountCents === null && ` · ${t('fixed.variable')}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums">{money(s.amountCents)}</span>
                  <button type="button" onClick={() => setEditing({ suggestion: s })} className={ghostButton}>
                    <Plus className="size-4" />
                    {t('fixed.addThis')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Movimientos
// --------------------------------------------------------------------------- //

function Movements({ data }: { data: FinanceOverview }) {
  const t = useTranslations('finance');
  const money = useMoney();
  const dates = useDates();
  const [month, setMonth] = useState(data.months[0]?.month ?? data.today.slice(0, 7));
  // Se guarda el mes al que pertenece la respuesta: si no coincide con el
  // elegido, está cargando.
  const [loaded, setLoaded] = useState<{ month: string; rows: TransactionView[] | null; error: string | null } | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    request<TransactionView[]>(`/api/finance/transactions?month=${month}`)
      .then((r) => !cancelled && setLoaded({ month, rows: r, error: null }))
      .catch((err: Error) => !cancelled && setLoaded({ month, rows: null, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const current = loaded?.month === month ? loaded : null;
  const rows = current?.rows ?? null;
  const error = current?.error ?? null;

  const q = query.trim().toLowerCase();
  const visible = rows?.filter(
    (r) => !q || r.description.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('summary.month')}>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass}>
            {data.months.map((m) => (
              <option key={m.month} value={m.month}>
                {dates.month(m.month)}
              </option>
            ))}
            {data.months.length === 0 && <option value={month}>{dates.month(month)}</option>}
          </select>
        </Field>
        <div className="min-w-[200px] flex-1">
          <Field label={t('movements.search')}>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{t('error', { reason: error })}</p>}
      {!rows && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </p>
      )}
      {visible && visible.length === 0 && <p className="text-sm text-muted-foreground">{t('movements.empty')}</p>}
      {visible && visible.length > 0 && (
        <section className="glass overflow-x-auto rounded-2xl p-2 sm:p-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-normal">{t('movements.date')}</th>
                <th className="px-2 py-2 font-normal">{t('movements.description')}</th>
                <th className="px-2 py-2 font-normal">{t('movements.category')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('movements.amount')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('movements.balance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{dates.shortDay(r.date)}</td>
                  <td className="px-2 py-2">
                    <span className="line-clamp-2">{r.description}</span>
                    {r.matched && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-state-live/15 px-2 py-0.5 text-xs">
                        <Check className="size-3" />
                        {r.matched}
                      </span>
                    )}
                    {r.comment && <span className="block text-xs text-muted-foreground">{r.comment}</span>}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {r.category ?? t('summary.uncategorized')}
                    {r.subcategory && <span className="block">{r.subcategory}</span>}
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${r.amountCents > 0 ? 'text-state-live' : ''}`}>
                    {money(r.amountCents, { sign: true })}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {r.balanceCents !== null ? money(r.balanceCents) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Importar
// --------------------------------------------------------------------------- //

function Import({ data, reload, notify }: { data: FinanceOverview; reload: () => Promise<void>; notify: Notify }) {
  const t = useTranslations('finance');
  const dates = useDates();
  const format = useFormatter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await request<ImportResult>('/api/finance/import', { method: 'POST', body });
      setResult(res);
      setFile(null);
      (e.target as HTMLFormElement).reset();
      await reload();
    } catch (err) {
      const code = (err as Error).message;
      const known = ['unreadable', 'unknown_format', 'empty', 'too_many_rows', 'too_large', 'no_file'];
      notify({ kind: 'error', text: known.includes(code) ? t(`import.errors.${code}`) : t('error', { reason: code }) });
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id: string) => {
    if (!window.confirm(t('import.confirmUndo'))) return;
    try {
      await request(`/api/finance/imports/${id}`, { method: 'DELETE' });
      setResult(null);
      await reload();
    } catch (err) {
      notify({ kind: 'error', text: t('error', { reason: (err as Error).message }) });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="glass rounded-2xl p-5">
        <h3 className="text-sm font-medium">{t('import.howTo')}</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>{t('import.step1')}</li>
          <li>{t('import.step2')}</li>
          <li>{t('import.step3')}</li>
          <li>{t('import.step4')}</li>
          <li>{t('import.step5')}</li>
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">{t('import.privacy')}</p>
      </section>

      <div className="space-y-4">
        <form onSubmit={upload} className="glass space-y-4 rounded-2xl p-5">
          <h3 className="text-sm font-medium">{t('import.upload')}</h3>
          <input
            type="file"
            accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent/60 file:px-3 file:py-1.5 file:text-sm"
          />
          <button type="submit" disabled={!file || busy} className={primaryButton}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t('import.submit')}
          </button>
          {result && (
            <p role="status" className="rounded-md border border-state-live/50 bg-state-live/10 px-3 py-2 text-sm">
              {t('import.result', {
                total: result.rowsTotal,
                fresh: result.rowsNew,
                updated: result.rowsUpdated,
                from: result.dateFrom ? dates.day(result.dateFrom) : '—',
                to: result.dateTo ? dates.day(result.dateTo) : '—',
              })}
            </p>
          )}
        </form>

        <section className="glass rounded-2xl p-5">
          <h3 className="text-sm font-medium">{t('import.history')}</h3>
          {data.imports.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('import.noHistory')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border/40 text-sm">
              {data.imports.map((imp) => (
                <li key={imp.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block">
                      {format.dateTime(new Date(imp.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
                      <span className="ml-2 text-xs text-muted-foreground">···{imp.account}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('import.historyLine', {
                        fresh: imp.rowsNew,
                        total: imp.rowsTotal,
                        from: imp.dateFrom ? dates.shortDay(imp.dateFrom) : '—',
                        to: imp.dateTo ? dates.shortDay(imp.dateTo) : '—',
                      })}
                    </span>
                  </span>
                  <button type="button" onClick={() => void undo(imp.id)} className={ghostButton} title={t('import.undoHint')}>
                    <Undo2 className="size-4" />
                    {t('import.undo')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Raíz
// --------------------------------------------------------------------------- //

export function FinanceClient() {
  const t = useTranslations('finance');
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : 'summary');
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await request<FinanceOverview>('/api/finance'));
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    request<FinanceOverview>('/api/finance')
      .then((d) => !cancelled && setData(d))
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'summary') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(tab);
    if (e.key === 'ArrowRight') select(TABS[(index + 1) % TABS.length]!);
    else if (e.key === 'ArrowLeft') select(TABS[(index - 1 + TABS.length) % TABS.length]!);
  };

  return (
    <div>
      <div className="mb-6 max-w-full overflow-x-auto">
        <div role="tablist" aria-label={t('title')} onKeyDown={onTabKey} className="inline-flex rounded-full border border-border/60 p-1">
          {TABS.map((id) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                id={`finance-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="finance-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => select(id)}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition ${
                  selected ? 'bg-foreground text-background' : 'hover:bg-accent/40'
                }`}
              >
                {t(`tabs.${id}`)}
              </button>
            );
          })}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className={`mb-4 rounded-md border px-3 py-2 text-sm ${
            notice.kind === 'error' ? 'border-destructive/50 bg-destructive/10' : 'border-state-live/50 bg-state-live/10'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div id="finance-panel" role="tabpanel" aria-labelledby={`finance-tab-${tab}`}>
        {!data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {loadError ? <AlertTriangle className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
            {loadError ? t('error', { reason: loadError }) : t('loading')}
          </p>
        ) : (
          <>
            {tab === 'summary' && <Summary data={data} onGoImport={() => select('import')} />}
            {tab === 'debts' && <Debts data={data} reload={reload} notify={setNotice} />}
            {tab === 'fixed' && <Fixed data={data} reload={reload} notify={setNotice} />}
            {tab === 'movements' && <Movements data={data} />}
            {tab === 'import' && <Import data={data} reload={reload} notify={setNotice} />}
          </>
        )}
      </div>
    </div>
  );
}
