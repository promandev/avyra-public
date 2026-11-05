import 'server-only';

/**
 * Cliente del minero de drops de Twitch (rangermix/TwitchDropsMiner).
 *
 * El minero NO descarga vídeo: envía a Twitch los eventos de "minuto visto" que
 * emitiría el reproductor web, que es lo único que acredita un drop. Por eso
 * cabe en la Raspberry sin competir por RAM con Postgres ni con la app.
 *
 * Su API no tiene autenticación propia, así que el contenedor vive en la red
 * `internal` de Docker sin publicar puerto: sólo se llega a él a través de las
 * rutas de Avyra, que exigen super admin. Nunca lo llames desde el cliente.
 */

const DEFAULT_TIMEOUT_MS = 8000;

export function getMinerUrl(): string | null {
  const url = process.env.TWITCH_MINER_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export function isMinerConfigured(): boolean {
  return getMinerUrl() !== null;
}

export class MinerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MinerUnavailableError';
  }
}

/**
 * Rutas del minero que el proxy genérico deja pasar tal cual. Todo lo demás se
 * rechaza. Las órdenes que cambian qué se mina van por `/api/streaming/control`,
 * que las valida y avisa a la automatización, así que no se exponen aquí.
 */
export const ALLOWED_PATHS = {
  GET: ['status', 'channels', 'campaigns', 'console', 'settings', 'version'],
  POST: ['oauth/confirm', 'reload'],
} as const;

export function isAllowed(method: 'GET' | 'POST', path: string): boolean {
  return (ALLOWED_PATHS[method] as readonly string[]).includes(path);
}

interface MinerRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Llama a la API del minero. Lanza `MinerUnavailableError` si no está
 * configurado o no responde, para poder distinguir "apagado" de "ha fallado".
 */
export async function minerRequest<T = unknown>(
  path: string,
  { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS }: MinerRequestOptions = {},
): Promise<{ status: number; data: T }> {
  const base = getMinerUrl();
  if (!base) throw new MinerUnavailableError('TWITCH_MINER_URL no está configurada');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/api/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { detail: text.slice(0, 500) };
      }
    }
    return { status: res.status, data: data as T };
  } catch (err) {
    if (err instanceof MinerUnavailableError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new MinerUnavailableError(`El minero no responde: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Tipos del payload del minero ────────────────────────────────────────────

export interface MinerChannel {
  id: number;
  name: string;
  game: string | null;
  game_id: string | null;
  game_icon: string | null;
  viewers: number;
  online: boolean;
  drops_enabled: boolean;
  acl_based: boolean;
  watching: boolean;
}

export interface MinerDrop {
  id: string;
  name: string;
  current_minutes: number;
  required_minutes: number;
  progress: number;
  is_claimed: boolean;
  can_claim: boolean;
  benefits: { name: string; type: string; image_url: string }[];
  ends_at: string;
}

export interface MinerCampaign {
  id: string;
  name: string;
  game_name: string;
  game_box_art_url: string | null;
  link_url: string | null;
  linked: boolean;
  active: boolean;
  upcoming: boolean;
  expired: boolean;
  ends_at: string;
  drops: MinerDrop[];
}

export interface MinerStatus {
  /** Texto libre de estado, p. ej. "Watching: <canal>". */
  status: string;
  login: {
    status: string;
    user_id: number | null;
    /** Presente mientras espera a que introduzcas el código en Twitch. */
    oauth_pending?: { url: string; code: string };
  };
  manual_mode: unknown;
}
