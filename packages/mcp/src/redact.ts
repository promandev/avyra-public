// Redacción de secretos aplicada a TODA salida de herramienta.
const REPLACEMENT = '[REDACTED]';

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, REPLACEMENT],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g, REPLACEMENT],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REPLACEMENT],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REPLACEMENT],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REPLACEMENT}`],
  // scheme://user:pass@host (incluye rtsp://)
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REPLACEMENT}@`],
  // KEY=valor cuando la clave contiene SECRET/TOKEN/PASSWORD/KEY
  [
    /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|KEY)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
    `$1$2${REPLACEMENT}`,
  ],
  // hex / base64 largo (>= 32 caracteres)
  [/\b[A-Fa-f0-9]{32,}\b/g, REPLACEMENT],
  [/[A-Za-z0-9+/_-]{32,}={0,2}/g, REPLACEMENT],
];

export function redactString(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out as T;
  }
  return value;
}
