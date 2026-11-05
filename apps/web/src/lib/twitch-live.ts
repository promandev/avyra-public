import 'server-only';

/**
 * Consulta si un canal de Twitch está emitiendo, y desde cuándo.
 *
 * Usa el endpoint GraphQL público con el Client-ID del reproductor web, que es
 * el mismo que emplea cualquier visita anónima a twitch.tv. No hace falta
 * registrar una aplicación ni guardar secretos: sólo lee datos que la web ya
 * muestra a cualquiera.
 *
 * Se consulta desde el servidor, nunca desde el navegador, para no exponer el
 * canal vigilado en el cliente ni gastar la cuota de la IP del visitante.
 */

const GQL_URL = 'https://gql.twitch.tv/gql';
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TIMEOUT_MS = 8000;

export interface LiveStream {
  /** Identificador de ESTA emisión. Cambia cada vez que el canal reabre. */
  streamId: string;
  /** Identificador estable del canal, el mismo que usa el minero. */
  channelId: number;
  login: string;
  startedAt: Date;
  gameName: string | null;
  gameId: string | null;
}

export class TwitchLookupError extends Error {
  /** True cuando el canal no existe, para no confundirlo con un fallo de red. */
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = 'TwitchLookupError';
  }
}

interface GqlResponse {
  data?: {
    user?: {
      id?: string;
      login?: string;
      stream?: {
        id?: string;
        createdAt?: string;
        type?: string;
        game?: { id?: string; name?: string } | null;
      } | null;
    } | null;
  };
}

/**
 * Devuelve la emisión en curso, o `null` si el canal está apagado.
 * Lanza `TwitchLookupError` si Twitch no responde: eso NO es lo mismo que estar
 * apagado, y quien llama debe distinguirlo para no cortar una sesión buena por
 * un fallo de red pasajero.
 */
export async function getLiveStream(login: string): Promise<LiveStream | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: {
        'Client-ID': WEB_CLIENT_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query{user(login:"${login.replace(/[^a-zA-Z0-9_]/g, '')}"){id login stream{id createdAt type game{id name}}}}`,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new TwitchLookupError(`Twitch respondió ${res.status}`);
    }

    const body = (await res.json()) as GqlResponse;
    const user = body.data?.user;
    if (!user) throw new TwitchLookupError(`El canal ${login} no existe`, true);

    const stream = user.stream;
    // `type` distingue directo de retransmisión de material grabado; sólo el
    // directo acredita drops.
    if (!stream?.id || !stream.createdAt || stream.type !== 'live') return null;

    const startedAt = new Date(stream.createdAt);
    if (Number.isNaN(startedAt.getTime())) {
      throw new TwitchLookupError('Twitch devolvió una fecha de inicio ilegible');
    }

    return {
      streamId: stream.id,
      channelId: Number(user.id),
      login: user.login ?? login,
      startedAt,
      gameName: stream.game?.name ?? null,
      gameId: stream.game?.id ?? null,
    };
  } catch (err) {
    if (err instanceof TwitchLookupError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new TwitchLookupError(`No se pudo consultar Twitch: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}
