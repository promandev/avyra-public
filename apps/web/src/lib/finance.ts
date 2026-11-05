import 'server-only';
import { createHash } from 'node:crypto';

import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  financeDebts,
  financeImports,
  financeRecurring,
  financeTransactions,
  getDb,
} from '@pradomotica/db';

import { decrypt, encrypt } from './crypto';
import { newId } from './id';
import type { ParsedStatement } from './finance-ing';
import { buildLedger, debtSeries, normalizeText, projectDebt, todayMadrid } from './finance-math';
import type {
  DebtDetail,
  DebtInput,
  DebtKind,
  DebtLedger,
  DebtView,
  FinanceOverview,
  FixedStatus,
  ImportResult,
  ImportView,
  MonthSummary,
  RecurringInput,
  RecurringSuggestion,
  RecurringView,
  TransactionView,
} from './finance-types';

/** Meses que se resumen en la portada. */
const SUMMARY_MONTHS = 12;
const UNCATEGORIZED = '—';

// --------------------------------------------------------------------------- //
// Deudas y pagos fijos
// --------------------------------------------------------------------------- //

type DebtRow = typeof financeDebts.$inferSelect;
type RecurringRow = typeof financeRecurring.$inferSelect;

function toDebtInput(row: DebtRow): DebtInput {
  return {
    name: row.name,
    lender: row.lender,
    kind: row.kind as DebtKind,
    balanceCents: row.balanceCents,
    balanceAsOf: row.balanceAsOf,
    monthlyPaymentCents: row.monthlyPaymentCents,
    paymentDay: row.paymentDay,
    annualRate: row.annualRate,
    endDate: row.endDate,
    rateReviewDate: row.rateReviewDate,
    matchText: row.matchText,
    matchAmountCents: row.matchAmountCents,
    notes: row.notes,
  };
}

function toRecurringView(row: RecurringRow): RecurringView {
  return {
    id: row.id,
    name: row.name,
    amountCents: row.amountCents,
    dayOfMonth: row.dayOfMonth,
    matchText: row.matchText,
    matchAmountCents: row.matchAmountCents,
    active: row.active,
  };
}

export async function createDebt(userId: string, input: DebtInput): Promise<string> {
  const id = newId();
  await getDb().insert(financeDebts).values({ id, ownerUserId: userId, ...input });
  return id;
}

/** Devuelve false si la deuda no existe o no es de este usuario. */
export async function updateDebt(userId: string, id: string, input: DebtInput): Promise<boolean> {
  const rows = await getDb()
    .update(financeDebts)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(financeDebts.id, id), eq(financeDebts.ownerUserId, userId)))
    .returning({ id: financeDebts.id });
  return rows.length > 0;
}

export async function deleteDebt(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(financeDebts)
    .where(and(eq(financeDebts.id, id), eq(financeDebts.ownerUserId, userId)))
    .returning({ id: financeDebts.id });
  return rows.length > 0;
}

export async function createRecurring(userId: string, input: RecurringInput): Promise<string> {
  const id = newId();
  await getDb().insert(financeRecurring).values({ id, ownerUserId: userId, ...input });
  return id;
}

export async function updateRecurring(userId: string, id: string, input: RecurringInput): Promise<boolean> {
  const rows = await getDb()
    .update(financeRecurring)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(financeRecurring.id, id), eq(financeRecurring.ownerUserId, userId)))
    .returning({ id: financeRecurring.id });
  return rows.length > 0;
}

export async function deleteRecurring(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(financeRecurring)
    .where(and(eq(financeRecurring.id, id), eq(financeRecurring.ownerUserId, userId)))
    .returning({ id: financeRecurring.id });
  return rows.length > 0;
}

// --------------------------------------------------------------------------- //
// Importación
// --------------------------------------------------------------------------- //

/**
 * Clave estable de un movimiento entre exportaciones solapadas. `seq` separa
 * dos filas idénticas dentro del mismo fichero (sólo posible sin saldo).
 */
function dedupeKey(account: string, date: string, amount: number, balance: number | null, seq: number) {
  return createHash('sha256').update(`${account}|${date}|${amount}|${balance ?? ''}|${seq}`).digest('hex');
}

/**
 * Guarda los movimientos de un extracto. Los que ya estaban no se duplican:
 * sólo se actualizan si ING ha cambiado su categoría o su descripción (pasa
 * con los pagos con tarjeta de los últimos días, que llegan sin categorizar).
 */
export async function importStatement(userId: string, statement: ParsedStatement): Promise<ImportResult> {
  const { account, rows } = statement;
  const seen = new Map<string, number>();
  const keyed = rows.map((row) => {
    const base = `${row.date}|${row.amountCents}|${row.balanceCents ?? ''}`;
    const seq = seen.get(base) ?? 0;
    seen.set(base, seq + 1);
    return { row, key: dedupeKey(account, row.date, row.amountCents, row.balanceCents, seq) };
  });

  const dates = rows.map((r) => r.date).sort();
  const dateFrom = dates[0] ?? null;
  const dateTo = dates.at(-1) ?? null;

  return getDb().transaction(async (tx) => {
    const existing = new Map<string, { id: string; category: string | null; subcategory: string | null; descriptionEnc: string }>();
    const keys = keyed.map((k) => k.key);
    for (let i = 0; i < keys.length; i += 500) {
      const found = await tx
        .select({
          id: financeTransactions.id,
          key: financeTransactions.dedupeKey,
          category: financeTransactions.category,
          subcategory: financeTransactions.subcategory,
          descriptionEnc: financeTransactions.descriptionEnc,
        })
        .from(financeTransactions)
        .where(and(eq(financeTransactions.ownerUserId, userId), inArray(financeTransactions.dedupeKey, keys.slice(i, i + 500))));
      for (const f of found) existing.set(f.key, f);
    }

    const importId = newId();
    await tx.insert(financeImports).values({
      id: importId,
      ownerUserId: userId,
      account,
      rowsTotal: rows.length,
      rowsNew: 0,
      rowsUpdated: 0,
      dateFrom,
      dateTo,
    });

    const inserts: (typeof financeTransactions.$inferInsert)[] = [];
    let updated = 0;
    for (const { row, key } of keyed) {
      const prev = existing.get(key);
      if (!prev) {
        inserts.push({
          id: newId(),
          ownerUserId: userId,
          account,
          valueDate: row.date,
          amountCents: row.amountCents,
          balanceCents: row.balanceCents,
          category: row.category,
          subcategory: row.subcategory,
          descriptionEnc: encrypt(row.description),
          commentEnc: row.comment ? encrypt(row.comment) : null,
          dedupeKey: key,
          importId,
        });
        continue;
      }
      // Una categoría que desaparece en el extracto nuevo no borra la que había.
      const category = row.category ?? prev.category;
      const subcategory = row.subcategory ?? prev.subcategory;
      const descriptionChanged = decrypt(prev.descriptionEnc) !== row.description;
      if (category === prev.category && subcategory === prev.subcategory && !descriptionChanged) continue;
      await tx
        .update(financeTransactions)
        .set({
          category,
          subcategory,
          ...(descriptionChanged ? { descriptionEnc: encrypt(row.description) } : {}),
        })
        .where(eq(financeTransactions.id, prev.id));
      updated++;
    }

    for (let i = 0; i < inserts.length; i += 500) {
      await tx.insert(financeTransactions).values(inserts.slice(i, i + 500));
    }
    await tx
      .update(financeImports)
      .set({ rowsNew: inserts.length, rowsUpdated: updated })
      .where(eq(financeImports.id, importId));

    return { importId, account, rowsTotal: rows.length, rowsNew: inserts.length, rowsUpdated: updated, dateFrom, dateTo };
  });
}

/** Deshace una importación: borra los movimientos que entraron con ella. */
export async function deleteImport(userId: string, id: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: financeImports.id })
      .from(financeImports)
      .where(and(eq(financeImports.id, id), eq(financeImports.ownerUserId, userId)))
      .limit(1);
    if (!row) return false;
    await tx
      .delete(financeTransactions)
      .where(and(eq(financeTransactions.importId, id), eq(financeTransactions.ownerUserId, userId)));
    await tx.delete(financeImports).where(eq(financeImports.id, id));
    return true;
  });
}

// --------------------------------------------------------------------------- //
// Lectura y cruce con deudas / pagos fijos
// --------------------------------------------------------------------------- //

interface Tx {
  id: string;
  account: string;
  date: string;
  amountCents: number;
  balanceCents: number | null;
  category: string | null;
  subcategory: string | null;
  description: string;
  comment: string | null;
}

async function loadTransactions(userId: string, from: string, to?: string): Promise<Tx[]> {
  const rows = await getDb()
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.ownerUserId, userId),
        gte(financeTransactions.valueDate, from),
        ...(to ? [lt(financeTransactions.valueDate, to)] : []),
      ),
    )
    .orderBy(desc(financeTransactions.valueDate), asc(financeTransactions.account));
  return orderByBalanceChain(
    rows.map((r) => ({
      id: r.id,
      account: r.account,
      date: r.valueDate,
      amountCents: r.amountCents,
      balanceCents: r.balanceCents,
      category: r.category,
      subcategory: r.subcategory,
      description: decrypt(r.descriptionEnc),
      comment: r.commentEnc ? decrypt(r.commentEnc) : null,
    })),
  );
}

/**
 * Ordena los movimientos de cada día del más reciente al más antiguo.
 *
 * La BD no guarda el orden dentro del día, pero se deduce del saldo: cada
 * movimiento deja `saldo` y partía de `saldo - importe`, así que el último del
 * día es aquel cuyo saldo no es el de partida de ningún otro.
 */
function orderByBalanceChain(txs: Tx[]): Tx[] {
  const out: Tx[] = [];
  let i = 0;
  while (i < txs.length) {
    let j = i;
    while (j < txs.length && txs[j]!.date === txs[i]!.date && txs[j]!.account === txs[i]!.account) j++;
    const day = txs.slice(i, j);
    i = j;
    if (day.length < 2 || day.some((t) => t.balanceCents === null)) {
      out.push(...day);
      continue;
    }
    const byBalance = new Map<number, Tx[]>();
    for (const t of day) {
      const list = byBalance.get(t.balanceCents!) ?? [];
      list.push(t);
      byBalance.set(t.balanceCents!, list);
    }
    const starts = new Set(day.map((t) => t.balanceCents! - t.amountCents));
    const used = new Set<string>();
    let current = day.find((t) => !starts.has(t.balanceCents!));
    while (current && !used.has(current.id)) {
      used.add(current.id);
      out.push(current);
      const prevBalance: number = current.balanceCents! - current.amountCents;
      current = byBalance.get(prevBalance)?.find((t) => !used.has(t.id));
    }
    out.push(...day.filter((t) => !used.has(t.id)));
  }
  return out;
}

interface Rule {
  ref: FixedStatus['ref'];
  name: string;
  expectedCents: number;
  text: string;
  amount: number | null;
}

function rulesFor(debts: (DebtInput & { id: string })[], recurring: RecurringView[]): Rule[] {
  const rules: Rule[] = [];
  for (const d of debts) {
    if (!d.matchText) continue;
    rules.push({
      ref: { kind: 'debt', id: d.id },
      name: d.name,
      expectedCents: -(d.matchAmountCents ?? d.monthlyPaymentCents),
      text: normalizeText(d.matchText),
      amount: d.matchAmountCents,
    });
  }
  for (const r of recurring) {
    if (!r.active || !r.matchText) continue;
    rules.push({
      ref: { kind: 'recurring', id: r.id },
      name: r.name,
      expectedCents: r.amountCents,
      text: normalizeText(r.matchText),
      amount: r.matchAmountCents,
    });
  }
  // Las reglas con importe exacto van primero: son más concretas y no deben
  // perder su movimiento frente a una que sólo mira el texto.
  return rules.sort((a, b) => Number(b.amount !== null) - Number(a.amount !== null));
}

function ruleMatches(rule: Rule, tx: Tx): boolean {
  if (!normalizeText(tx.description).includes(rule.text)) return false;
  return rule.amount === null || Math.abs(Math.abs(tx.amountCents) - rule.amount) <= 1;
}

/** Asigna cada movimiento como mucho a una regla, y cada regla a uno por mes. */
function matchMonth(rules: Rule[], txs: Tx[]): { status: FixedStatus[]; matched: Map<string, Rule> } {
  const matched = new Map<string, Rule>();
  const status: FixedStatus[] = [];
  for (const rule of rules) {
    const tx = txs.find((t) => !matched.has(t.id) && ruleMatches(rule, t));
    if (tx) matched.set(tx.id, rule);
    status.push({
      ref: rule.ref,
      name: rule.name,
      expectedCents: rule.expectedCents,
      actualCents: tx?.amountCents ?? null,
      date: tx?.date ?? null,
    });
  }
  return { status, matched };
}

const monthOf = (date: string) => date.slice(0, 7);

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function summarize(month: string, txs: Tx[], rules: Rule[], partial: boolean): MonthSummary {
  const { status, matched } = matchMonth(rules, txs);
  let income = 0;
  let expense = 0;
  let fixed = 0;
  const categories = new Map<string, number>();
  for (const t of txs) {
    if (t.amountCents >= 0) {
      income += t.amountCents;
      continue;
    }
    const spent = -t.amountCents;
    expense += spent;
    if (matched.has(t.id)) fixed += spent;
    const cat = t.category ?? UNCATEGORIZED;
    categories.set(cat, (categories.get(cat) ?? 0) + spent);
  }
  return {
    month,
    incomeCents: income,
    expenseCents: expense,
    fixedCents: fixed,
    variableCents: expense - fixed,
    netCents: income - expense,
    count: txs.length,
    categories: [...categories].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
    fixed: status,
    partial,
  };
}

/**
 * Cargos que se repiten y nadie ha dado de alta: misma descripción con el mismo
 * importe en 3 meses distintos, o un recibo de importe parecido todos los meses.
 */
function suggest(txs: Tx[], matchedIds: Set<string>, rules: Rule[]): RecurringSuggestion[] {
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (matchedIds.has(t.id)) continue;
    const key = normalizeText(t.description).replace(/\d+/g, '#');
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const out: RecurringSuggestion[] = [];
  for (const list of groups.values()) {
    const sample = list[0]!;
    const text = sample.description.replace(/\s+/g, ' ').trim();
    if (rules.some((r) => normalizeText(text).includes(r.text) && r.amount === null)) continue;

    const byAmount = new Map<number, Tx[]>();
    for (const t of list) byAmount.set(t.amountCents, [...(byAmount.get(t.amountCents) ?? []), t]);
    let found = false;
    for (const [amount, same] of byAmount) {
      const months = new Set(same.map((t) => monthOf(t.date))).size;
      if (months < 3) continue;
      found = true;
      out.push({ name: text, matchText: text, amountCents: amount, matchAmountCents: Math.abs(amount), dayOfMonth: mostCommonDay(same), months });
    }
    if (found) continue;

    const months = new Set(list.map((t) => monthOf(t.date))).size;
    const amounts = list.map((t) => Math.abs(t.amountCents));
    const isReceipt = normalizeText(text).startsWith('recibo');
    if (isReceipt && months >= 3 && Math.max(...amounts) <= Math.min(...amounts) * 1.5) {
      const avg = Math.round(list.reduce((s, t) => s + t.amountCents, 0) / list.length);
      out.push({ name: text, matchText: text, amountCents: avg, matchAmountCents: null, dayOfMonth: mostCommonDay(list), months });
    }
  }
  return out.sort((a, b) => a.amountCents - b.amountCents).slice(0, 20);
}

function mostCommonDay(txs: Tx[]): number | null {
  const counts = new Map<number, number>();
  for (const t of txs) {
    const d = Number(t.date.slice(8, 10));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Todo lo necesario para pintar la sección: deudas con su historial real,
 * pagos fijos y todos los movimientos ya cruzados con ellos. Carga el histórico
 * completo porque el pendiente de una deuda depende de todos sus pagos.
 */
async function loadContext(userId: string) {
  const db = getDb();
  const today = todayMadrid();
  const [debtRows, recurringRows] = await Promise.all([
    db.select().from(financeDebts).where(eq(financeDebts.ownerUserId, userId)).orderBy(asc(financeDebts.createdAt)),
    db.select().from(financeRecurring).where(eq(financeRecurring.ownerUserId, userId)).orderBy(asc(financeRecurring.createdAt)),
  ]);
  const inputs = debtRows.map((row) => ({ id: row.id, ...toDebtInput(row) }));
  const recurring = recurringRows.map(toRecurringView);
  const rules = rulesFor(inputs, recurring);

  const txs = await loadTransactions(userId, '1900-01-01');
  const byMonth = new Map<string, Tx[]>();
  for (const t of txs) {
    const list = byMonth.get(monthOf(t.date)) ?? [];
    list.push(t);
    byMonth.set(monthOf(t.date), list);
  }
  const matched = new Map<string, Rule>();
  for (const list of byMonth.values()) {
    for (const [id, rule] of matchMonth(rules, list).matched) matched.set(id, rule);
  }
  const coverage = txs.length ? { from: txs.at(-1)!.date, to: txs[0]!.date } : null;

  const ledgers = new Map<string, DebtLedger>();
  const debts: DebtView[] = inputs.map(({ id, ...input }) => {
    const charges = txs
      .filter((t) => matched.get(t.id)?.ref.id === id && t.amountCents < 0)
      .map((t) => ({ date: t.date, chargedCents: -t.amountCents }));
    const ledger = buildLedger(input, charges, coverage, today);
    ledgers.set(id, ledger);
    const { rows, ...summary } = ledger;
    void rows;
    return { id, ...input, projection: projectDebt(input, today, ledger), ledger: summary };
  });

  return { today, debts, ledgers, recurring, rules, txs, byMonth, matched };
}

export async function getOverview(userId: string): Promise<FinanceOverview> {
  const ctx = await loadContext(userId);
  const { today, debts, recurring, rules, txs, byMonth, matched } = ctx;
  const importRows = await getDb()
    .select()
    .from(financeImports)
    .where(eq(financeImports.ownerUserId, userId))
    .orderBy(desc(financeImports.createdAt))
    .limit(10);

  const firstMonth = shiftMonth(monthOf(today), -(SUMMARY_MONTHS - 1));
  const oldest = txs.at(-1)?.date;
  const months = [...byMonth.keys()]
    .filter((m) => m >= firstMonth)
    .sort()
    .reverse()
    .map((month) =>
      summarize(
        month,
        byMonth.get(month)!,
        rules,
        month === monthOf(today) || (oldest !== undefined && month === monthOf(oldest) && !oldest.endsWith('-01')),
      ),
    );

  const recent = txs.filter((t) => t.date >= `${firstMonth}-01`);
  const latest = txs.find((t) => t.balanceCents !== null);
  const toImportView = (r: typeof financeImports.$inferSelect): ImportView => ({
    id: r.id,
    account: r.account,
    rowsTotal: r.rowsTotal,
    rowsNew: r.rowsNew,
    rowsUpdated: r.rowsUpdated,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    createdAt: r.createdAt.toISOString(),
  });

  return {
    today,
    debts,
    recurring,
    months,
    imports: importRows.map(toImportView),
    suggestions: suggest(recent, new Set(matched.keys()), rules),
    latestBalance: latest ? { cents: latest.balanceCents!, date: latest.date, account: latest.account } : null,
    monthlyFixedCents:
      debts
        .filter((d) => (d.projection.paymentsLeft ?? 1) > 0)
        .reduce((s, d) => s + (d.matchAmountCents ?? d.monthlyPaymentCents), 0) +
      recurring.filter((r) => r.active && r.amountCents < 0).reduce((s, r) => s - r.amountCents, 0),
    monthlyFixedIncomeCents: recurring.filter((r) => r.active && r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0),
    totalDebtCents: debts.reduce((s, d) => s + (d.projection.currentBalanceCents ?? d.projection.remainingToPayCents ?? 0), 0),
  };
}

/** Una deuda con todos sus pagos y la evolución del saldo. Null si no es tuya. */
export async function getDebtDetail(userId: string, id: string): Promise<DebtDetail | null> {
  const ctx = await loadContext(userId);
  const debt = ctx.debts.find((d) => d.id === id);
  const ledger = ctx.ledgers.get(id);
  if (!debt || !ledger) return null;
  return { debt, rows: ledger.rows, series: debtSeries(debt, ledger, ctx.today) };
}

/** Movimientos de un mes ('YYYY-MM'), con la deuda o pago fijo que cubren. */
export async function getTransactions(userId: string, month: string): Promise<TransactionView[]> {
  const db = getDb();
  const [debtRows, recurringRows] = await Promise.all([
    db.select().from(financeDebts).where(eq(financeDebts.ownerUserId, userId)),
    db.select().from(financeRecurring).where(eq(financeRecurring.ownerUserId, userId)),
  ]);
  const rules = rulesFor(
    debtRows.map((row) => ({ id: row.id, ...toDebtInput(row) })),
    recurringRows.map(toRecurringView),
  );

  const txs = await loadTransactions(userId, `${month}-01`, `${shiftMonth(month, 1)}-01`);
  const { matched } = matchMonth(rules, txs);
  return txs.map((t) => ({
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    balanceCents: t.balanceCents,
    category: t.category,
    subcategory: t.subcategory,
    description: t.description,
    comment: t.comment,
    matched: matched.get(t.id)?.name ?? null,
  }));
}
