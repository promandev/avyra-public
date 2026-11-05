/**
 * Cálculos de la sección Finanzas sin dependencias: fechas de calendario y
 * amortización de deudas. Puro para poder probarlo a mano con node.
 */

import type { DebtInput, DebtLedger, DebtProjection, LedgerRow, SeriesPoint } from './finance-types';

/** Fecha de hoy en Madrid como 'YYYY-MM-DD' (el servidor corre en UTC). */
export function todayMadrid(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y!, m!, d ?? 1];
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Fecha de cobro de la cuota en un mes: el día pedido, o el último si no existe. */
function paymentDate(y: number, m: number, day: number): string {
  return iso(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Cuotas cuyo cobro cae en (from, to]. */
export function paymentsBetween(from: string, to: string, day: number): number {
  if (to <= from) return 0;
  let [y, m] = parts(from);
  const [ty, tm] = parts(to);
  let count = 0;
  while (y < ty || (y === ty && m <= tm)) {
    const d = paymentDate(y, m, day);
    if (d > from && d <= to) count++;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return count;
}

/** Mes ('YYYY-MM') de la n-ésima cuota posterior a `from` (n ≥ 1). */
export function nthPaymentMonth(from: string, n: number, day: number): string {
  let [y, m] = parts(from);
  // Si la cuota de este mes aún no se ha cobrado, cuenta como la primera.
  if (paymentDate(y, m, day) <= from) n++;
  m += n - 1;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Meses completos de `from` a `to` (por mes de calendario). */
export function monthsUntil(from: string, to: string): number {
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  return (ty - fy) * 12 + (tm - fm);
}

/** Interés mensual que hace que `payment` liquide `balance` en `n` cuotas. */
function solveMonthlyRate(balance: number, payment: number, n: number): number {
  if (payment * n <= balance) return 0;
  let lo = 0;
  let hi = 0.05;
  for (let i = 0; i < 100; i++) {
    const r = (lo + hi) / 2;
    const p = (balance * r) / (1 - Math.pow(1 + r, -n));
    if (p > payment) hi = r;
    else lo = r;
  }
  return lo;
}

const MAX_MONTHS = 1200;

/** Interés mensual de la deuda: el puesto a mano o el que cuadra cuota y fecha de fin. */
export function debtMonthlyRate(debt: DebtInput): { rate: number | null; inferred: boolean } {
  if (debt.annualRate !== null) return { rate: debt.annualRate / 1200, inferred: false };
  if (debt.balanceCents === null || !debt.endDate) return { rate: null, inferred: false };
  const n = paymentsBetween(debt.balanceAsOf, debt.endDate, debt.paymentDay ?? 1);
  if (n <= 0) return { rate: null, inferred: false };
  return { rate: solveMonthlyRate(debt.balanceCents, debt.monthlyPaymentCents, n), inferred: true };
}

/** Cargo del banco atribuido a una deuda (en positivo). */
export interface DebtCharge {
  date: string;
  chargedCents: number;
}

/** Fechas de cobro previstas en (from, to], como 'YYYY-MM-DD'. */
function scheduledDates(from: string, to: string, day: number): string[] {
  const out: string[] = [];
  if (to <= from) return out;
  let [y, m] = parts(from);
  const [ty, tm] = parts(to);
  while (y < ty || (y === ty && m <= tm)) {
    const d = paymentDate(y, m, day);
    if (d > from && d <= to) out.push(d);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Historial de una deuda a partir de los cargos reales del banco.
 *
 * El saldo guardado es una foto a `balanceAsOf`. Desde ahí:
 *  - hacia atrás, cada cargo anterior a la foto reconstruye el saldo que había
 *    antes de pagarlo (saldo_antes = (saldo_después + cuota) / (1 + i));
 *  - hacia delante, cada cargo real posterior amortiza lo que de verdad se pagó.
 *
 * Los meses posteriores a la foto que el extracto cubre y en los que no aparece
 * el cargo se marcan como no encontrados (no se descuentan). Los que el extracto
 * aún no cubre (no se ha subido) se estiman con la cuota prevista.
 */
export function buildLedger(
  debt: DebtInput,
  charges: DebtCharge[],
  coverage: { from: string; to: string } | null,
  today: string,
): DebtLedger {
  const day = debt.paymentDay ?? 1;
  const { rate } = debtMonthlyRate(debt);
  const r = rate ?? 0;
  const known = debt.balanceCents !== null;
  // Si el cargo incluye algo más (345 € por una cuota de 300 €), sólo cuenta la cuota.
  const portion = (charged: number) =>
    debt.matchAmountCents !== null ? Math.min(charged, debt.monthlyPaymentCents) : charged;

  const sorted = [...charges].sort((a, b) => a.date.localeCompare(b.date));
  const before = sorted.filter((c) => c.date <= debt.balanceAsOf);
  const after = sorted.filter((c) => c.date > debt.balanceAsOf);
  const rows: LedgerRow[] = [];

  // Hacia atrás desde la foto.
  let back = debt.balanceCents ?? 0;
  const backRows: LedgerRow[] = [];
  for (const c of [...before].reverse()) {
    const debtCents = portion(c.chargedCents);
    const prev = (back + debtCents) / (1 + r);
    const interest = prev * r;
    backRows.unshift({
      date: c.date,
      chargedCents: c.chargedCents,
      debtCents,
      interestCents: known ? Math.round(interest) : null,
      principalCents: known ? Math.round(debtCents - interest) : null,
      balanceAfterCents: known ? Math.round(back) : null,
      kind: 'real',
    });
    back = prev;
  }
  rows.push(...backRows);
  const firstKnownBalanceCents = known ? Math.round(back) : null;

  // Hacia delante con los cargos reales.
  let balance = debt.balanceCents ?? 0;
  const apply = (date: string, chargedCents: number, debtCents: number, kind: LedgerRow['kind']) => {
    const interest = balance * r;
    const pay = Math.min(debtCents, balance + interest);
    balance = Math.max(0, balance + interest - pay);
    rows.push({
      date,
      chargedCents,
      debtCents,
      interestCents: known ? Math.round(interest) : null,
      principalCents: known ? Math.round(pay - interest) : null,
      balanceAfterCents: known ? Math.round(balance) : null,
      kind,
    });
  };
  for (const c of after) apply(c.date, c.chargedCents, portion(c.chargedCents), 'real');

  // Meses cubiertos por el extracto sin cargo, y meses aún sin extracto.
  const paidMonths = new Set(sorted.map((c) => c.date.slice(0, 7)));
  const coveredTo = coverage ? (coverage.to < today ? coverage.to : today) : debt.balanceAsOf;
  const missedMonths: string[] = [];
  if (coverage) {
    for (const d of scheduledDates(debt.balanceAsOf, coveredTo, day)) {
      if (d >= coverage.from && !paidMonths.has(d.slice(0, 7))) missedMonths.push(d.slice(0, 7));
    }
  }
  let estimatedPayments = 0;
  const estimateFrom = coveredTo > debt.balanceAsOf ? coveredTo : debt.balanceAsOf;
  for (const d of scheduledDates(estimateFrom, today, day)) {
    if (paidMonths.has(d.slice(0, 7))) continue;
    if (known && balance <= 0) break;
    apply(d, debt.matchAmountCents ?? debt.monthlyPaymentCents, debt.monthlyPaymentCents, 'estimated');
    estimatedPayments++;
  }

  const real = rows.filter((row) => row.kind === 'real');
  return {
    rows,
    currentBalanceCents: known ? Math.round(balance) : null,
    firstKnownBalanceCents,
    estimatedPayments,
    missedMonths,
    paidCents: real.reduce((s, row) => s + row.debtCents, 0),
    interestPaidCents: known ? real.reduce((s, row) => s + (row.interestCents ?? 0), 0) : null,
    principalPaidCents: known ? real.reduce((s, row) => s + (row.principalCents ?? 0), 0) : null,
    paymentsCount: real.length,
    lastPayment: real.length ? { date: real.at(-1)!.date, cents: real.at(-1)!.chargedCents } : null,
    coverage,
  };
}

/**
 * Proyección de una deuda a fecha `today`.
 *
 * Con historial (`ledger`), lo pendiente de hoy sale de los cargos reales. Sin
 * él se supone que cada cuota prevista desde la foto se ha pagado. Interés
 * mensual = TIN / 12, como en un préstamo francés.
 */
export function projectDebt(debt: DebtInput, today: string, ledger?: DebtLedger): DebtProjection {
  const day = debt.paymentDay ?? 1;
  const payment = debt.monthlyPaymentCents;
  const reviewInMonths =
    debt.rateReviewDate && debt.rateReviewDate > today ? monthsUntil(today, debt.rateReviewDate) : null;

  const empty: DebtProjection = {
    currentBalanceCents: null,
    rateUsed: debt.annualRate,
    rateInferred: false,
    paymentsLeft: null,
    projectedEnd: null,
    remainingToPayCents: null,
    remainingInterestCents: null,
    neverEnds: false,
    reviewInMonths,
    paidPercent: null,
  };

  // Sin saldo sólo se puede contar cuotas hasta la fecha de fin.
  if (debt.balanceCents === null) {
    if (!debt.endDate || payment <= 0) return empty;
    const left = paymentsBetween(today, debt.endDate, day);
    return {
      ...empty,
      paymentsLeft: left,
      projectedEnd: left > 0 ? nthPaymentMonth(today, left, day) : null,
      remainingToPayCents: left * payment,
    };
  }

  const { rate, inferred } = debtMonthlyRate(debt);
  const r = rate ?? 0;

  let balance = debt.balanceCents;
  if (ledger?.currentBalanceCents !== null && ledger?.currentBalanceCents !== undefined) {
    balance = ledger.currentBalanceCents;
  } else {
    const paid = paymentsBetween(debt.balanceAsOf, today, day);
    for (let i = 0; i < paid && balance > 0; i++) balance = Math.max(0, balance * (1 + r) - payment);
  }

  const neverEnds = payment <= 0 || balance * r >= payment;
  let left = 0;
  let total = 0;
  let interest = 0;
  if (!neverEnds) {
    let b = balance;
    while (b > 0.5 && left < MAX_MONTHS) {
      const due = b * r;
      const pay = Math.min(payment, b + due);
      b = b + due - pay;
      total += pay;
      interest += due;
      left++;
    }
  }

  const original = ledger?.firstKnownBalanceCents ?? debt.balanceCents;
  return {
    currentBalanceCents: Math.round(balance),
    rateUsed: rate === null ? null : Math.round(r * 1200 * 1000) / 1000,
    rateInferred: inferred,
    paymentsLeft: neverEnds ? null : left,
    projectedEnd: neverEnds || left === 0 ? null : nthPaymentMonth(today, left, day),
    remainingToPayCents: neverEnds ? null : Math.round(total),
    remainingInterestCents: neverEnds ? null : Math.round(interest),
    neverEnds,
    reviewInMonths,
    paidPercent: original > 0 ? Math.max(0, Math.min(100, ((original - balance) / original) * 100)) : null,
  };
}

/**
 * Evolución del saldo para la gráfica: lo pasado según el historial y, desde
 * hoy, lo previsto con la cuota actual (un punto por año hasta acabar).
 */
export function debtSeries(debt: DebtInput, ledger: DebtLedger, today: string): SeriesPoint[] {
  if (ledger.currentBalanceCents === null) return [];
  const points: SeriesPoint[] = [];
  // Sin pagos, la foto es el único punto conocido.
  if (ledger.rows.length === 0) points.push({ date: debt.balanceAsOf, balanceCents: debt.balanceCents ?? 0, kind: 'real' });
  for (const row of ledger.rows) {
    if (row.balanceAfterCents !== null) points.push({ date: row.date, balanceCents: row.balanceAfterCents, kind: row.kind === 'real' ? 'real' : 'projected' });
  }

  const { rate } = debtMonthlyRate(debt);
  const r = rate ?? 0;
  const day = debt.paymentDay ?? 1;
  const payment = debt.monthlyPaymentCents;
  let b = ledger.currentBalanceCents;
  if (payment <= 0 || b * r >= payment) return points;
  let n = 0;
  while (b > 0.5 && n < MAX_MONTHS) {
    b = Math.max(0, b * (1 + r) - payment);
    n++;
    if (n % 12 === 0 || b <= 0.5) {
      points.push({ date: `${nthPaymentMonth(today, n, day)}-01`, balanceCents: Math.round(b), kind: 'projected' });
    }
  }
  return points;
}

/** Texto en minúsculas y sin tildes, para comparar descripciones del banco. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
