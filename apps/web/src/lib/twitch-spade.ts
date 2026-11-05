import 'server-only';

import type { LiveStream } from './twitch-live';

/**
 * El «minuto visto» de Twitch: lo que acredita que una cuenta está viendo un
 * canal, igual que lo manda el reproductor web cada minuto.
 *
 * Es el mismo evento que usa el minero de drops (`Stream._spade_payload` en
 * TwitchDropsMiner): un POST de analítica a `beacon.twitch.tv` con el
 * identificador de usuario, el canal y la emisión. No lleva el token de la
 * cuenta: la cookie `auth-token` pertenece sólo a `www.twitch.tv` y ni el
 * minero la manda a este dominio. Por eso Avyra no necesita tocar la
 * autorización guardada en el contenedor del minero.
 */

const WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/** Valor observado en septiembre de 2026; sólo se usa si falla la extracción. */
const FALLBACK_SPADE_URL = 'https://beacon.twitch.tv/track';
const SPADE_TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

const SPADE_PATTERN = /"beacon_?url": ?"(https:\/\/[^"]+)"/i;
const SETTINGS_PATTERN = /src="(https:\/\/[\w.]+\/config\/settings\.[0-9a-f]{32}\.js)"/i;

let cachedSpade: { url: string; at: number } | null = null;

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': WEB_USER_AGENT },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * URL a la que se mandan los eventos. Twitch la publica en la página del canal
 * o en su fichero de configuración, y puede cambiar, así que se extrae igual
 * que hace el minero y se guarda unas horas.
 */
async function getSpadeUrl(login: string): Promise<string> {
  if (cachedSpade && Date.now() - cachedSpade.at < SPADE_TTL_MS) return cachedSpade.url;

  try {
    const html = await fetchText(`https://www.twitch.tv/${encodeURIComponent(login)}`);
    let match = SPADE_PATTERN.exec(html);
    if (!match) {
      const settings = SETTINGS_PATTERN.exec(html)?.[1];
      if (settings) match = SPADE_PATTERN.exec(await fetchText(settings));
    }
    const url = match?.[1];
    if (url) {
      cachedSpade = { url, at: Date.now() };
      return url;
    }
  } catch {
    // Se cae al valor conocido. No se guarda, para reintentar la extracción.
  }
  return FALLBACK_SPADE_URL;
}

/**
 * Manda un minuto visto y devuelve el código HTTP. Twitch contesta 204 cuando lo
 * acepta. Que lo acepte no garantiza que lo acredite; eso sólo se ve en los
 * puntos del canal.
 */
export async function sendMinuteWatched({
  userId,
  deviceId,
  live,
}: {
  userId: string;
  /** Identificador de dispositivo propio y estable, como el de un navegador. */
  deviceId: string;
  live: LiveStream;
}): Promise<number> {
  const payload = [
    {
      event: 'minute-watched',
      properties: {
        broadcast_id: live.streamId,
        channel_id: String(live.channelId),
        channel: live.login,
        client_time: new Date().toISOString(),
        game: live.gameName ?? '',
        game_id: live.gameId ?? '',
        hidden: false,
        is_live: true,
        live: true,
        location: 'channel',
        logged_in: true,
        minutes_logged: 1,
        muted: false,
        player: 'site',
        user_id: Number(userId),
      },
    },
  ];
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const url = await getSpadeUrl(live.login);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': WEB_USER_AGENT,
        Origin: 'https://www.twitch.tv',
        Referer: `https://www.twitch.tv/${live.login}`,
        Cookie: `unique_id=${deviceId}; unique_id_durable=${deviceId}`,
      },
      body: new URLSearchParams({ data }).toString(),
      signal: controller.signal,
      cache: 'no-store',
    });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}
