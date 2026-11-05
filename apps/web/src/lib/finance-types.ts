/**
 * Tipos compartidos entre las rutas de `/api/finance` y la interfaz. Sin
 * imports de servidor: este fichero llega al navegador.
 *
 * Importes siempre en céntimos (enteros) y fechas como 'YYYY-MM-DD'.
 */

export const DEBT_KINDS = ['mortgage', 'loan', 'family', 'other'] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export interface DebtInput {
  name: string;
  lender: string | null;
  kind: DebtKind;
  /** Capital pendiente a `balanceAsOf`; null si no se sabe. */
  balanceCents: number | null;
  balanceAsOf: string;
  monthlyPaymentCents: number;
  paymentDay: number | null;
  /** TIN anual en %. */
  annualRate: number | null;
  endDate: string | null;
  rateReviewDate: string | null;
  matchText: string | null;
  matchAmountCents: number | null;
  notes: string | null;
}

export interface DebtProjection {
  /** Pendiente estimado hoy, aplicando las cuotas pasadas desde la foto. */
  currentBalanceCents: number | null;
  /** TIN usado en el cálculo (puesto a mano o deducido). */
  rateUsed: number | null;
  /** True si el TIN no lo has puesto tú: se ha sacado de la fecha de fin. */
  rateInferred: boolean;
  paymentsLeft: number | null;
  /** Mes de la última cuota, 'YYYY-MM'. */
  projectedEnd: string | null;
  /** Lo que falta por pagar sumando cuotas (capital + intereses). */
  remainingToPayCents: number | null;
  remainingInterestCents: number | null;
  /** La cuota no cubre ni los intereses: así no se acaba nunca. */
  neverEnds: boolean;
  /** Meses que faltan para la revisión del tipo (hipoteca mixta). */
  reviewInMonths: number | null;
  /** Porcentaje ya devuelto respecto al primer saldo conocido. */
  paidPercent: number | null;
}

/** Un pago de la deuda: real (visto en el banco) o estimado (mes aún sin extracto). */
export interface LedgerRow {
  date: string;
  /** Lo que se cargó en el banco (en positivo). */
  chargedCents: number;
  /** La parte de ese cargo que es cuota de esta deuda. */
  debtCents: number;
  interestCents: number | null;
  principalCents: number | null;
  /** Pendiente tras el pago; null si la deuda no tiene saldo conocido. */
  balanceAfterCents: number | null;
  kind: 'real' | 'estimated';
}

export interface DebtLedger {
  /** Del más antiguo al más reciente. */
  rows: LedgerRow[];
  currentBalanceCents: number | null;
  /** Pendiente antes del primer pago del historial. */
  firstKnownBalanceCents: number | null;
  /** Cuotas supuestas porque el extracto de esos meses aún no se ha subido. */
  estimatedPayments: number;
  /** Meses ('YYYY-MM') cubiertos por el extracto en los que no aparece el cargo. */
  missedMonths: string[];
  paidCents: number;
  interestPaidCents: number | null;
  principalPaidCents: number | null;
  paymentsCount: number;
  lastPayment: { date: string; cents: number } | null;
  /** Fechas que cubren los extractos importados. */
  coverage: { from: string; to: string } | null;
}

export interface SeriesPoint {
  date: string;
  balanceCents: number;
  kind: 'real' | 'projected';
}

export interface DebtView extends DebtInput {
  id: string;
  projection: DebtProjection;
  ledger: Omit<DebtLedger, 'rows'>;
}

export interface DebtDetail {
  debt: DebtView;
  rows: LedgerRow[];
  series: SeriesPoint[];
}

export interface RecurringInput {
  name: string;
  /** Con signo: negativo gasto, positivo ingreso. */
  amountCents: number;
  dayOfMonth: number | null;
  matchText: string | null;
  matchAmountCents: number | null;
  active: boolean;
}

export interface RecurringView extends RecurringInput {
  id: string;
}

/** Estado de un cargo fijo esperado en un mes concreto. */
export interface FixedStatus {
  ref: { kind: 'debt' | 'recurring'; id: string };
  name: string;
  expectedCents: number;
  /** Importe real encontrado en el banco, con signo; null si no ha llegado. */
  actualCents: number | null;
  date: string | null;
}

export interface MonthSummary {
  /** 'YYYY-MM' */
  month: string;
  incomeCents: number;
  /** En positivo. */
  expenseCents: number;
  /** Gastos que corresponden a deudas o pagos fijos dados de alta. */
  fixedCents: number;
  variableCents: number;
  netCents: number;
  count: number;
  /** Gastos por categoría del banco, de mayor a menor (en positivo). */
  categories: { name: string; cents: number }[];
  fixed: FixedStatus[];
  /** True si el mes no está completo en los datos (el actual o el primero). */
  partial: boolean;
}

export interface ImportView {
  id: string;
  account: string;
  rowsTotal: number;
  rowsNew: number;
  rowsUpdated: number;
  dateFrom: string | null;
  dateTo: string | null;
  createdAt: string;
}

/** Cargo que se repite en el banco y no está dado de alta todavía. */
export interface RecurringSuggestion {
  name: string;
  matchText: string;
  amountCents: number;
  /** Null si el importe varía de un mes a otro. */
  matchAmountCents: number | null;
  dayOfMonth: number | null;
  months: number;
}

export interface FinanceOverview {
  today: string;
  debts: DebtView[];
  recurring: RecurringView[];
  months: MonthSummary[];
  imports: ImportView[];
  suggestions: RecurringSuggestion[];
  /** Saldo tras el último movimiento importado. */
  latestBalance: { cents: number; date: string; account: string } | null;
  /** Suma de cuotas de deudas y gastos fijos activos, en positivo. */
  monthlyFixedCents: number;
  monthlyFixedIncomeCents: number;
  totalDebtCents: number;
}

export interface TransactionView {
  id: string;
  date: string;
  amountCents: number;
  balanceCents: number | null;
  category: string | null;
  subcategory: string | null;
  description: string;
  comment: string | null;
  /** Deuda o pago fijo al que corresponde, si alguno. */
  matched: string | null;
}

export interface ImportResult {
  importId: string;
  account: string;
  rowsTotal: number;
  rowsNew: number;
  rowsUpdated: number;
  dateFrom: string | null;
  dateTo: string | null;
}
