import 'server-only';

import {
  IppError,
  IppOp,
  encodeRequest,
  groupsOf,
  ippRequest,
  ippToHttp,
  num,
  numbers,
  str,
  strings,
  type IppAttr,
} from './ipp';
import {
  PRINT_MAX_BYTES,
  type PrintColorMode,
  type PrintJob,
  type PrintJobState,
  type PrinterInk,
  type PrinterStatus,
} from './printer-types';

/**
 * Impresora de casa (HP DeskJet 2600) a través del CUPS interno.
 *
 * Dos caminos distintos, a propósito:
 *  - Los trabajos van a CUPS, porque la impresora no entiende PDF y alguien
 *    tiene que rasterizarlo. CUPS además los guarda si la impresora está
 *    dormida y los reintenta.
 *  - El estado y la tinta se leen de la propia impresora: CUPS sólo actualiza
 *    `marker-levels` mientras imprime, así que ahí estarían desfasados.
 */

const QUEUE = 'deskjet';

function config() {
  const cups = process.env.CUPS_URL?.trim().replace(/\/+$/, '');
  const printerUri = process.env.PRINTER_URI?.trim();
  if (!cups || !printerUri || /XX/i.test(printerUri)) return null;

  const cupsHost = new URL(cups).host;
  return {
    queueHttp: `${cups}/printers/${QUEUE}`,
    queueUri: `ipp://${cupsHost}/printers/${QUEUE}`,
    printerUri,
    printerHttp: ippToHttp(printerUri),
  };
}

export function isPrinterConfigured(): boolean {
  return config() !== null;
}

export class PrinterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrinterUnavailableError';
  }
}

function requireConfig() {
  const c = config();
  if (!c) throw new PrinterUnavailableError('printer_not_configured');
  return c;
}

// ---------- Formatos ----------------------------------------------------------

/**
 * Tipo del documento por su contenido, no por lo que diga el navegador. Sólo
 * lo que cups-filters convierte sin LibreOffice.
 */
export function detectDocumentFormat(buf: Buffer, fileName: string): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (/\.txt$/i.test(fileName) && !buf.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      return 'text/plain';
    } catch {
      return null;
    }
  }
  return null;
}

/** "1-3, 5" → rangos IPP. `null` si el texto no es válido. */
export function parsePageRanges(input: string): { lower: number; upper: number }[] | null {
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 50) return null;

  const ranges: { lower: number; upper: number }[] = [];
  for (const part of parts) {
    const m = /^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/.exec(part);
    if (!m) return null;
    const lower = Number(m[1]);
    const upper = m[2] ? Number(m[2]) : lower;
    if (lower < 1 || upper < lower) return null;
    ranges.push({ lower, upper });
  }
  // IPP exige rangos ascendentes y sin solapes.
  ranges.sort((a, b) => a.lower - b.lower);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.lower <= ranges[i - 1]!.upper) return null;
  }
  return ranges;
}

// ---------- Estado ------------------------------------------------------------

const PRINTER_STATE: Record<number, PrinterStatus['state']> = {
  3: 'idle',
  4: 'processing',
  5: 'stopped',
};

/** Quita los sufijos de severidad: "media-empty-error" → "media-empty". */
function normalizeReason(reason: string): string {
  return reason.replace(/-(report|warning|error)$/, '');
}

function readInks(attrs: Parameters<typeof str>[0]): PrinterInk[] {
  const names = strings(attrs, 'marker-names');
  const levels = numbers(attrs, 'marker-levels');
  const lows = numbers(attrs, 'marker-low-levels');
  const colors = strings(attrs, 'marker-colors');
  const types = strings(attrs, 'marker-types');

  return names.map((name, i) => {
    const level = levels[i];
    // Negativos = desconocido (-1, -2) o "queda algo" (-3).
    const known = typeof level === 'number' && level >= 0;
    return {
      name,
      level: known ? Math.min(100, level) : null,
      low: known && typeof lows[i] === 'number' ? level <= lows[i]! : false,
      // Los cartuchos tricolor llegan como "#00FFFF#FF00FF#FFFF00".
      colors: (colors[i] ?? '').match(/#[0-9a-f]{6}/gi) ?? [],
      type: types[i] ?? null,
    };
  });
}

/**
 * Última lectura buena de la impresora.
 *
 * Mientras imprime, la DeskJet rechaza cualquier otra conexión IPP, así que la
 * consulta directa falla justo cuando más se mira la pantalla. Guardar el
 * modelo y la tinta evita que la tarjeta se quede vacía en ese rato.
 */
let lastGoodRead: { model: string | null; inks: PrinterInk[]; at: number } | null = null;
const LAST_GOOD_TTL_MS = 6 * 60 * 60 * 1000;

export async function getPrinterStatus(): Promise<PrinterStatus> {
  const c = requireConfig();

  const [direct, queue] = await Promise.allSettled([
    ippRequest(
      c.printerHttp,
      encodeRequest(IppOp.GetPrinterAttributes, c.printerUri, [
        {
          tag: 'keyword',
          name: 'requested-attributes',
          values: [
            'printer-state',
            'printer-state-reasons',
            'printer-state-message',
            'printer-make-and-model',
            'marker-names',
            'marker-levels',
            'marker-low-levels',
            'marker-colors',
            'marker-types',
          ],
        },
      ]),
      // Si está dormida responde tarde o nada: no puede frenar la página.
      { timeoutMs: 6000 },
    ),
    ippRequest(
      c.queueHttp,
      encodeRequest(IppOp.GetPrinterAttributes, c.queueUri, [
        {
          tag: 'keyword',
          name: 'requested-attributes',
          values: ['printer-state', 'printer-state-message', 'printer-is-accepting-jobs', 'queued-job-count'],
        },
      ]),
      { timeoutMs: 6000 },
    ),
  ]);

  const printerAttrs = direct.status === 'fulfilled' ? groupsOf(direct.value, 'printer')[0]?.attrs : undefined;
  const queueAttrs = queue.status === 'fulfilled' ? groupsOf(queue.value, 'printer')[0]?.attrs : undefined;

  const reasons = printerAttrs
    ? strings(printerAttrs, 'printer-state-reasons').filter((r) => r !== 'none').map(normalizeReason)
    : [];

  if (printerAttrs) {
    lastGoodRead = {
      model: str(printerAttrs, 'printer-make-and-model'),
      inks: readInks(printerAttrs),
      at: Date.now(),
    };
  }
  const remembered = lastGoodRead && Date.now() - lastGoodRead.at < LAST_GOOD_TTL_MS ? lastGoodRead : null;

  // La cola es la segunda opinión: si CUPS está imprimiendo, la impresora está
  // viva aunque no nos coja el teléfono, y decir "sin conexión" sería mentir.
  const queueState = queueAttrs ? PRINTER_STATE[num(queueAttrs, 'printer-state') ?? 0] : undefined;
  const state: PrinterStatus['state'] = printerAttrs
    ? (PRINTER_STATE[num(printerAttrs, 'printer-state') ?? 0] ?? 'idle')
    : queueState === 'processing'
      ? 'processing'
      : 'offline';

  return {
    online: !!printerAttrs || state === 'processing',
    queueReady: !!queueAttrs,
    state,
    reasons: [...new Set(reasons)],
    model: printerAttrs ? str(printerAttrs, 'printer-make-and-model') : (remembered?.model ?? null),
    message: (printerAttrs && str(printerAttrs, 'printer-state-message')) || null,
    queueMessage: (queueAttrs && str(queueAttrs, 'printer-state-message')) || null,
    acceptingJobs: queueAttrs ? queueAttrs['printer-is-accepting-jobs']?.[0] !== false : false,
    queuedJobs: queueAttrs ? (num(queueAttrs, 'queued-job-count') ?? 0) : 0,
    inks: printerAttrs ? readInks(printerAttrs) : (remembered?.inks ?? []),
  };
}

/**
 * Estado visto sólo desde el CUPS interno, sin preguntar a la impresora.
 *
 * Lo usa el sondeo de avisos: `getPrinterStatus` consulta también a la
 * impresora, y despertarla cada minuto para nada es justo lo que no queremos.
 * CUPS ya arrastra los motivos que importan (sin papel, atasco, tapa abierta)
 * mientras hay trabajo en marcha, que es cuando el aviso sirve.
 */
export async function getQueueSnapshot(): Promise<{
  state: PrinterStatus['state'];
  reasons: string[];
  message: string | null;
  acceptingJobs: boolean;
}> {
  const c = requireConfig();

  const res = await ippRequest(
    c.queueHttp,
    encodeRequest(IppOp.GetPrinterAttributes, c.queueUri, [
      {
        tag: 'keyword',
        name: 'requested-attributes',
        values: [
          'printer-state',
          'printer-state-reasons',
          'printer-state-message',
          'printer-is-accepting-jobs',
        ],
      },
    ]),
    { timeoutMs: 6000 },
  );

  const attrs = groupsOf(res, 'printer')[0]?.attrs;
  const reasons = attrs
    ? strings(attrs, 'printer-state-reasons').filter((r) => r !== 'none').map(normalizeReason)
    : [];

  return {
    state: attrs ? (PRINTER_STATE[num(attrs, 'printer-state') ?? 0] ?? 'idle') : 'offline',
    reasons: [...new Set(reasons)],
    message: (attrs && str(attrs, 'printer-state-message')) || null,
    acceptingJobs: attrs ? attrs['printer-is-accepting-jobs']?.[0] !== false : false,
  };
}


// ---------- Trabajos ----------------------------------------------------------

const JOB_STATE: Record<number, PrintJobState> = {
  3: 'pending',
  4: 'held',
  5: 'processing',
  6: 'stopped',
  7: 'canceled',
  8: 'aborted',
  9: 'completed',
};

function isoFromUnix(seconds: number | null): string | null {
  return seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

export async function listJobs(limit = 15): Promise<PrintJob[]> {
  const c = requireConfig();

  const res = await ippRequest(
    c.queueHttp,
    encodeRequest(IppOp.GetJobs, c.queueUri, [
      { tag: 'keyword', name: 'which-jobs', values: ['all'] },
      { tag: 'integer', name: 'limit', values: [100] },
      {
        tag: 'keyword',
        name: 'requested-attributes',
        values: [
          'job-id',
          'job-name',
          'job-state',
          'job-state-reasons',
          'job-printer-state-message',
          'job-originating-user-name',
          'job-media-sheets-completed',
          'time-at-creation',
          'time-at-completed',
        ],
      },
    ]),
  );

  return groupsOf(res, 'job')
    .map(({ attrs }) => ({
      id: num(attrs, 'job-id') ?? 0,
      name: str(attrs, 'job-name') ?? '',
      state: JOB_STATE[num(attrs, 'job-state') ?? 0] ?? 'pending',
      reasons: strings(attrs, 'job-state-reasons').filter((r) => r !== 'none'),
      message: str(attrs, 'job-printer-state-message') || null,
      user: str(attrs, 'job-originating-user-name'),
      sheets: num(attrs, 'job-media-sheets-completed'),
      createdAt: isoFromUnix(num(attrs, 'time-at-creation')),
      completedAt: isoFromUnix(num(attrs, 'time-at-completed')),
    }))
    .filter((j) => j.id > 0)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export interface SubmitJobInput {
  document: Buffer;
  fileName: string;
  format: string;
  user: string;
  copies: number;
  colorMode: PrintColorMode;
  pageRanges: { lower: number; upper: number }[] | null;
}

export async function submitJob(input: SubmitJobInput): Promise<number> {
  const c = requireConfig();
  if (input.document.length > PRINT_MAX_BYTES) throw new IppError('file_too_large');

  const isImage = input.format.startsWith('image/');
  const jobAttrs: IppAttr[] = [
    { tag: 'integer', name: 'copies', values: [input.copies] },
    { tag: 'keyword', name: 'print-color-mode', values: [input.colorMode] },
  ];
  if (input.pageRanges && input.format === 'application/pdf') {
    jobAttrs.push({ tag: 'rangeOfInteger', name: 'page-ranges', values: input.pageRanges });
  }
  if (isImage) {
    // Una foto del móvil tiene más píxeles que un folio: sin esto cups-filters
    // la imprime a su tamaño "real" y sale recortada.
    jobAttrs.push({ tag: 'keyword', name: 'print-scaling', values: ['fit'] });
    jobAttrs.push({ tag: 'boolean', name: 'fit-to-page', values: [true] });
  }

  const res = await ippRequest(
    c.queueHttp,
    encodeRequest(
      IppOp.PrintJob,
      c.queueUri,
      [
        { tag: 'name', name: 'requesting-user-name', values: [input.user.slice(0, 127)] },
        { tag: 'name', name: 'job-name', values: [input.fileName.slice(0, 200)] },
        { tag: 'mimeMediaType', name: 'document-format', values: [input.format] },
      ],
      jobAttrs,
    ),
    // CUPS contesta en cuanto guarda el archivo; convertir viene después.
    { timeoutMs: 30_000, document: input.document },
  );

  const jobGroup = groupsOf(res, 'job')[0];
  const jobId = jobGroup ? num(jobGroup.attrs, 'job-id') : null;
  if (!jobId) throw new IppError('CUPS no devolvió el número de trabajo');
  return jobId;
}

export async function cancelJob(jobId: number, user: string): Promise<void> {
  const c = requireConfig();
  await ippRequest(
    c.queueHttp,
    encodeRequest(IppOp.CancelJob, c.queueUri, [
      { tag: 'integer', name: 'job-id', values: [jobId] },
      { tag: 'name', name: 'requesting-user-name', values: [user.slice(0, 127)] },
    ]),
  );
}
