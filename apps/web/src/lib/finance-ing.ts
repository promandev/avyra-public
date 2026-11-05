import 'server-only';

import { normalizeText } from './finance-math';

/**
 * Lector del Excel de movimientos que exporta ING (web → Cuenta → Movimientos →
 * descargar → Excel). Es un .xls de verdad (BIFF8, generado con JasperReports):
 *
 *   fila 0-2   cabecera libre: "Número de cuenta:", "Titular:", "Fecha exportación:"
 *   fila 3     F. VALOR | CATEGORÍA | SUBCATEGORÍA | DESCRIPCIÓN | COMENTARIO | IMPORTE (€) | SALDO (€)
 *   fila 4…    un movimiento por fila, del más reciente al más antiguo
 *
 * Las columnas se localizan por su título y no por posición, por si ING añade
 * o reordena alguna. Del titular y del número de cuenta sólo se conservan los
 * cuatro últimos dígitos de la cuenta.
 */

export class FinanceImportError extends Error {
  constructor(public readonly code: 'unreadable' | 'unknown_format' | 'empty' | 'too_many_rows') {
    super(code);
  }
}

export interface ParsedRow {
  date: string;
  amountCents: number;
  balanceCents: number | null;
  category: string | null;
  subcategory: string | null;
  description: string;
  comment: string | null;
}

export interface ParsedStatement {
  account: string;
  rows: ParsedRow[];
}

const MAX_ROWS = 20_000;

/** Títulos aceptados por columna, ya normalizados (sin tildes, minúsculas). */
const COLUMNS = {
  date: ['f. valor', 'fecha valor', 'fecha'],
  category: ['categoria'],
  subcategory: ['subcategoria'],
  description: ['descripcion', 'concepto'],
  comment: ['comentario'],
  amount: ['importe (€)', 'importe (eur)', 'importe'],
  balance: ['saldo (€)', 'saldo (eur)', 'saldo'],
} as const;

type Cell = string | number | boolean | null;

function text(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  const s = String(cell).trim();
  return s === '' ? null : s;
}

/** Importe a céntimos: número de Excel o texto en formato español ("1.234,56"). */
function cents(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? Math.round(cell * 100) : null;
  const s = text(cell);
  if (!s) return null;
  const normalized = s.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function parseIngStatement(data: Buffer): Promise<ParsedStatement> {
  const XLSX = await import('xlsx');

  let rows: Cell[][];
  try {
    const wb = XLSX.read(data, { type: 'buffer', cellDates: false, cellFormula: false, cellHTML: false });
    const sheet = wb.Sheets[wb.SheetNames[0] ?? ''];
    if (!sheet) throw new FinanceImportError('unreadable');
    rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  } catch (err) {
    if (err instanceof FinanceImportError) throw err;
    throw new FinanceImportError('unreadable');
  }

  // Fila de títulos: la primera que tenga fecha e importe.
  const headerIndex = rows.findIndex((row) => {
    const names = row.map((c) => normalizeText(String(c ?? '')));
    return names.some((n) => (COLUMNS.date as readonly string[]).includes(n)) &&
      names.some((n) => (COLUMNS.amount as readonly string[]).includes(n));
  });
  if (headerIndex < 0) throw new FinanceImportError('unknown_format');

  const header = rows[headerIndex]!.map((c) => normalizeText(String(c ?? '')));
  const col = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    date: col(COLUMNS.date),
    category: col(COLUMNS.category),
    subcategory: col(COLUMNS.subcategory),
    description: col(COLUMNS.description),
    comment: col(COLUMNS.comment),
    amount: col(COLUMNS.amount),
    balance: col(COLUMNS.balance),
  };
  if (idx.description < 0) throw new FinanceImportError('unknown_format');

  const account = findAccount(rows.slice(0, headerIndex));

  const toDate = (cell: Cell): string | null => {
    if (typeof cell === 'number') {
      const d = XLSX.SSF.parse_date_code(cell);
      if (!d || !d.y) return null;
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    const m = text(cell)?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
  };

  const at = (row: Cell[], i: number): Cell => (i >= 0 ? (row[i] ?? null) : null);

  const parsed: ParsedRow[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const date = toDate(at(row, idx.date));
    const amountCents = cents(at(row, idx.amount));
    // Pies de página, totales o filas vacías: sin fecha o sin importe no es un movimiento.
    if (!date || amountCents === null) continue;
    parsed.push({
      date,
      amountCents,
      balanceCents: cents(at(row, idx.balance)),
      category: text(at(row, idx.category)),
      subcategory: text(at(row, idx.subcategory)),
      description: text(at(row, idx.description)) ?? '',
      comment: text(at(row, idx.comment)),
    });
    if (parsed.length > MAX_ROWS) throw new FinanceImportError('too_many_rows');
  }
  if (parsed.length === 0) throw new FinanceImportError('empty');

  return { account, rows: parsed };
}

/** Últimos 4 dígitos del "Número de cuenta:" de la cabecera. */
function findAccount(rows: Cell[][]): string {
  for (const row of rows) {
    const i = row.findIndex((c) => normalizeText(String(c ?? '')).startsWith('numero de cuenta'));
    if (i < 0) continue;
    const value = row.slice(i + 1).map(text).find(Boolean);
    const digits = value?.replace(/\D/g, '') ?? '';
    if (digits.length >= 4) return digits.slice(-4);
  }
  return 'ING';
}
