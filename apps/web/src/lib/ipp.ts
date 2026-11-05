import 'server-only';

/**
 * Cliente IPP mínimo (RFC 8010/8011), sin dependencias.
 *
 * Lo usan tanto CUPS como la propia impresora: IPP es HTTP POST con un cuerpo
 * binario de "grupos de atributos" seguido, si lo hay, del documento. Los
 * paquetes npm que lo implementan llevan años sin mantenimiento, y aquí sólo
 * hacen falta cuatro operaciones.
 */

export const IppOp = {
  PrintJob: 0x0002,
  CancelJob: 0x0008,
  GetJobs: 0x000a,
  GetPrinterAttributes: 0x000b,
} as const;

const GROUP = { operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05 } as const;

const TAG = {
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

export type IppValue =
  | string
  | number
  | boolean
  | { lower: number; upper: number }
  | { [member: string]: IppValue[] }
  | null;

/** Atributo a enviar. `values` admite varios para los atributos 1setOf. */
export type IppAttr =
  | { tag: 'keyword' | 'name' | 'text' | 'uri' | 'mimeMediaType'; name: string; values: string[] }
  | { tag: 'integer' | 'enum'; name: string; values: number[] }
  | { tag: 'boolean'; name: string; values: boolean[] }
  | { tag: 'rangeOfInteger'; name: string; values: { lower: number; upper: number }[] };

export interface IppResponse {
  status: number;
  groups: { tag: number; attrs: Record<string, IppValue[]> }[];
}

export class IppError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'IppError';
    this.status = status;
  }
}

// ---------- Codificación ------------------------------------------------------

class Writer {
  private chunks: Buffer[] = [];

  u8(n: number) {
    this.chunks.push(Buffer.from([n]));
  }
  u16(n: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    this.chunks.push(b);
  }
  i32(n: number) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    this.chunks.push(b);
  }
  bytes(b: Buffer) {
    this.u16(b.length);
    this.chunks.push(b);
  }
  value(tag: number, name: string, payload: Buffer) {
    this.u8(tag);
    this.bytes(Buffer.from(name, 'utf8'));
    this.bytes(payload);
  }
  build() {
    return Buffer.concat(this.chunks);
  }
}

function int32(n: number) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

function writeAttr(w: Writer, attr: IppAttr) {
  attr.values.forEach((v, i) => {
    // Los valores adicionales de un 1setOf van con el nombre vacío.
    const name = i === 0 ? attr.name : '';
    switch (attr.tag) {
      case 'integer':
      case 'enum':
        w.value(TAG[attr.tag], name, int32(v as number));
        break;
      case 'boolean':
        w.value(TAG.boolean, name, Buffer.from([v ? 1 : 0]));
        break;
      case 'rangeOfInteger': {
        const r = v as { lower: number; upper: number };
        w.value(TAG.rangeOfInteger, name, Buffer.concat([int32(r.lower), int32(r.upper)]));
        break;
      }
      default:
        w.value(TAG[attr.tag], name, Buffer.from(v as string, 'utf8'));
    }
  });
}

let requestCounter = 1;

export function encodeRequest(
  operation: number,
  printerUri: string,
  operationAttrs: IppAttr[] = [],
  jobAttrs: IppAttr[] = [],
): Buffer {
  const w = new Writer();
  w.u8(2); // versión 2.0
  w.u8(0);
  w.u16(operation);
  requestCounter = (requestCounter % 0x7fffffff) + 1;
  w.i32(requestCounter);

  w.u8(GROUP.operation);
  // El orden de estos tres lo exige la RFC: charset, idioma y destino primero.
  w.value(TAG.charset, 'attributes-charset', Buffer.from('utf-8'));
  w.value(TAG.naturalLanguage, 'attributes-natural-language', Buffer.from('es'));
  w.value(TAG.uri, 'printer-uri', Buffer.from(printerUri, 'utf8'));
  operationAttrs.forEach((a) => writeAttr(w, a));

  if (jobAttrs.length > 0) {
    w.u8(GROUP.job);
    jobAttrs.forEach((a) => writeAttr(w, a));
  }

  w.u8(GROUP.end);
  return w.build();
}

// ---------- Decodificación ----------------------------------------------------

class Reader {
  pos = 0;
  private buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  get done() {
    return this.pos >= this.buf.length;
  }
  u8() {
    return this.buf.readUInt8(this.pos++);
  }
  u16() {
    const n = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return n;
  }
  i32() {
    const n = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return n;
  }
  slice(len: number) {
    if (this.pos + len > this.buf.length) throw new IppError('Respuesta IPP truncada');
    const s = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
}

function decodeValue(tag: number, raw: Buffer): IppValue {
  switch (tag) {
    case TAG.integer:
    case TAG.enum:
      return raw.length === 4 ? raw.readInt32BE(0) : null;
    case TAG.boolean:
      return raw[0] === 1;
    case TAG.rangeOfInteger:
      return raw.length === 8 ? { lower: raw.readInt32BE(0), upper: raw.readInt32BE(4) } : null;
    case TAG.textWithLanguage:
    case TAG.nameWithLanguage: {
      const langLen = raw.readUInt16BE(0);
      const textLen = raw.readUInt16BE(2 + langLen);
      return raw.subarray(4 + langLen, 4 + langLen + textLen).toString('utf8');
    }
    case TAG.octetString:
    case TAG.dateTime:
    case TAG.resolution:
      return null;
    default:
      // text, name, keyword, uri, charset, mimeMediaType... y los out-of-band
      // (unknown, no-value), que llegan con longitud cero.
      return tag >= 0x40 ? raw.toString('utf8') : null;
  }
}

/** Lee los miembros de una colección hasta su `endCollection`. */
function readCollection(r: Reader): { [member: string]: IppValue[] } {
  const out: { [member: string]: IppValue[] } = {};
  let member = '';
  while (!r.done) {
    const tag = r.u8();
    r.slice(r.u16()); // nombre: siempre vacío dentro de una colección
    const raw = r.slice(r.u16());
    if (tag === TAG.endCollection) return out;
    if (tag === TAG.memberAttrName) {
      member = raw.toString('utf8');
      out[member] = [];
      continue;
    }
    const value = tag === TAG.begCollection ? readCollection(r) : decodeValue(tag, raw);
    (out[member] ??= []).push(value);
  }
  return out;
}

export function decodeResponse(buf: Buffer): IppResponse {
  if (buf.length < 9) throw new IppError('Respuesta IPP vacía');
  const r = new Reader(buf);
  r.u16(); // versión
  const status = r.u16();
  r.i32(); // request-id

  const groups: IppResponse['groups'] = [];
  let current: IppResponse['groups'][number] | null = null;
  let lastName = '';

  while (!r.done) {
    const tag = r.u8();
    if (tag === GROUP.end) break;
    if (tag < 0x10) {
      current = { tag, attrs: {} };
      groups.push(current);
      continue;
    }
    if (!current) throw new IppError('Respuesta IPP mal formada');

    const name = r.slice(r.u16()).toString('utf8');
    const raw = r.slice(r.u16());
    if (name) lastName = name;

    const value = tag === TAG.begCollection ? readCollection(r) : decodeValue(tag, raw);
    (current.attrs[lastName] ??= []).push(value);
  }

  return { status, groups };
}

// ---------- Transporte --------------------------------------------------------

/** `ipp://host/ruta` → `http://host:631/ruta`, que es lo que entiende fetch. */
export function ippToHttp(uri: string): string {
  const url = new URL(uri.replace(/^ipp(s?):/i, 'http$1:'));
  if (!url.port) url.port = '631';
  return url.toString();
}

export async function ippRequest(
  httpUrl: string,
  body: Buffer,
  { timeoutMs = 8000, document }: { timeoutMs?: number; document?: Buffer } = {},
): Promise<IppResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = document ? Buffer.concat([body, document]) : body;
    const res = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/ipp' },
      body: new Uint8Array(payload),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new IppError(`HTTP ${res.status}`);
    const decoded = decodeResponse(Buffer.from(await res.arrayBuffer()));
    // 0x0000-0x00FF son éxitos (0x0001: "algún atributo se ignoró o sustituyó").
    if (decoded.status > 0x00ff) {
      const message = firstString(decoded, 'status-message');
      throw new IppError(message ?? `IPP 0x${decoded.status.toString(16).padStart(4, '0')}`, decoded.status);
    }
    return decoded;
  } catch (err) {
    if (err instanceof IppError) throw err;
    const reason = controller.signal.aborted ? 'timeout' : err instanceof Error ? err.message : String(err);
    throw new IppError(reason);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Lectura cómoda ----------------------------------------------------

export function groupsOf(res: IppResponse, tag: keyof typeof GROUP) {
  return res.groups.filter((g) => g.tag === GROUP[tag]);
}

export function firstString(res: IppResponse, name: string): string | null {
  for (const g of res.groups) {
    const v = g.attrs[name]?.[0];
    if (typeof v === 'string') return v;
  }
  return null;
}

export function str(attrs: Record<string, IppValue[]>, name: string): string | null {
  const v = attrs[name]?.[0];
  return typeof v === 'string' ? v : null;
}

export function num(attrs: Record<string, IppValue[]>, name: string): number | null {
  const v = attrs[name]?.[0];
  return typeof v === 'number' ? v : null;
}

export function strings(attrs: Record<string, IppValue[]>, name: string): string[] {
  return (attrs[name] ?? []).filter((v): v is string => typeof v === 'string');
}

export function numbers(attrs: Record<string, IppValue[]>, name: string): number[] {
  return (attrs[name] ?? []).filter((v): v is number => typeof v === 'number');
}
