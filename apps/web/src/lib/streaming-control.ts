import 'server-only';
import { randomInt } from 'node:crypto';

import {
  getAutomationState,
  patchAutomationState,
  startMining,
  stopMining,
  type AutomationState,
} from './streaming-automation';
import { isCampaignMinable } from './twitch-drops';
import { getLiveStream, TwitchLookupError } from './twitch-live';
import { minerRequest, type MinerCampaign, type MinerChannel } from './twitch-miner';

/**
 * Órdenes manuales de la sección Streaming.
 *
 * Van todas detrás de una ruta (`/api/streaming/control`) y no como server
 * actions. Next ejecuta las server actions de un cliente de una en una: con el
 * panel sondeándose cada pocos segundos, un clic esperaba a que acabase el
 * sondeo en curso y parecía que el botón no respondía.
 *
 * Hay dos mandos independientes:
 *  - El minero de drops: qué juego se mina y en qué canal.
 *  - El seguimiento: ver a una persona concreta con el visor propio, juegue a
 *    lo que juegue. Encender o apagar «Viendo ahora» a mano toma el control
 *    hasta la próxima emisión, para que la automatización no lo deshaga.
 *
 * Las órdenes del minero de drops ya no tocan el seguimiento, y viceversa.
 */

/** Cuánto se espera a que el minero descubra canales del juego elegido. */
const CHANNEL_WAIT_MS = 15_000;
const CHANNEL_POLL_MS = 1_500;

const MANUAL_NOTE = 'Control manual hasta la próxima emisión del canal seguido';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Error con mensaje apto para enseñar al usuario y su código HTTP. */
export class ControlError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ControlError';
  }
}

export interface StreamingPanel {
  /** False si el contenedor del minero no contesta. */
  minerOk: boolean;
  /** Juegos que vigila el minero ahora mismo. Vacío equivale a apagado. */
  minerGames: string[];
  mining: boolean;
  autoEnabled: boolean;
  targetChannel: string | null;
  joinAfterMin: number | null;
  leaveAfterMin: number | null;
  joinedAt: string | null;
  finishedAt: string | null;
  lastTickAt: string | null;
  lastTickNote: string | null;
  /** «Viendo ahora»: el visor propio del canal seguido está encendido. */
  viewerOn: boolean;
  viewerLastAt: string | null;
  viewerLastNote: string | null;
}

export async function getPanel(): Promise<StreamingPanel> {
  const state = await getAutomationState();

  let minerOk = false;
  let minerGames: string[] = [];
  try {
    const { status, data } = await minerRequest<{ games_to_watch?: string[] }>('settings');
    minerOk = status < 400;
    minerGames = minerOk ? (data?.games_to_watch ?? []) : [];
  } catch {
    // Minero caído: el panel se pinta igual, con los mandos que dependen de él
    // deshabilitados, en vez de dejar la sección entera sin responder.
  }

  return {
    minerOk,
    minerGames,
    mining: minerGames.length > 0,
    autoEnabled: state.autoEnabled,
    targetChannel: state.preferredChannelName,
    joinAfterMin: state.joinAfterMin,
    leaveAfterMin: state.leaveAfterMin,
    joinedAt: state.joinedAt?.toISOString() ?? null,
    finishedAt: state.finishedAt?.toISOString() ?? null,
    lastTickAt: state.lastTickAt?.toISOString() ?? null,
    lastTickNote: state.lastTickNote,
    viewerOn: state.viewerOn,
    viewerLastAt: state.viewerLastAt?.toISOString() ?? null,
    viewerLastNote: state.viewerLastNote,
  };
}

/** POST al minero que convierte su rechazo en un error legible. */
async function minerPost<T>(path: string, body: unknown = {}): Promise<T | null> {
  const { status, data } = await minerRequest<(T & { detail?: unknown }) | null>(path, {
    method: 'POST',
    body,
  });
  if (status >= 400) {
    const detail = typeof data?.detail === 'string' ? data.detail : `HTTP ${status}`;
    throw new ControlError(`El minero rechazó la orden: ${detail}`, 502);
  }
  return data;
}

/**
 * Cierra para la automatización la emisión en curso del canal seguido, de modo
 * que no encienda ni apague «Viendo ahora» por encima de lo hecho a mano.
 */
async function takeManualControl(state: AutomationState): Promise<void> {
  const now = new Date();

  if (state.sessionKey) {
    if (!state.finishedAt) {
      await patchAutomationState({ finishedAt: now, lastTickNote: MANUAL_NOTE });
    }
    return;
  }

  // Armada pero sin sesión registrada todavía: si ya está emitiendo, se registra
  // esa emisión como cerrada para que el siguiente tick no la abra.
  if (!state.autoEnabled || !state.preferredChannelName) return;
  try {
    const live = await getLiveStream(state.preferredChannelName);
    if (!live) return;
    await patchAutomationState({
      sessionKey: live.streamId,
      sessionStartedAt: live.startedAt,
      joinAfterMin: null,
      leaveAfterMin: null,
      joinedAt: null,
      finishedAt: now,
      lastTickNote: MANUAL_NOTE,
    });
  } catch {
    // Sin respuesta de Twitch no hay sesión que proteger todavía.
  }
}

// ─── Minero de drops ─────────────────────────────────────────────────────────

/**
 * Mina un juego: lo pone como único vigilado y fija un canal al azar entre los
 * que emiten con drops activos. Si `preferChannelId` está entre ellos, gana.
 */
export async function startGame(
  game: string,
  preferChannelId?: number | null,
): Promise<{ game: string; channel: string | null }> {
  const wanted = game.trim().toLowerCase();
  if (!wanted) throw new ControlError('Falta indicar el juego');

  const { data: inventory } = await minerRequest<{ campaigns?: MinerCampaign[] }>('campaigns');
  const campaigns = (inventory?.campaigns ?? []).filter(
    (c) => c.game_name.toLowerCase() === wanted,
  );
  const [first] = campaigns;
  if (!first) throw new ControlError(`El minero no tiene campañas de ${game.trim()}`, 404);
  if (!campaigns.some(isCampaignMinable)) {
    throw new ControlError(
      `Las campañas de ${first.game_name} exigen vincular la cuenta con el juego antes de minar`,
      409,
    );
  }
  // El minero compara nombres sin mayúsculas, pero se le manda el nombre tal
  // cual lo publica Twitch para que la interfaz lo reconozca como "Minando".
  const name = first.game_name;

  await patchAutomationState({ targetGames: [name] });
  await minerPost('settings', { games_to_watch: [name] });

  const deadline = Date.now() + CHANNEL_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(CHANNEL_POLL_MS);
    const { data } = await minerRequest<{ channels?: MinerChannel[] }>('channels');
    const candidates = (data?.channels ?? []).filter(
      (c) => c.online && c.drops_enabled && c.game?.toLowerCase() === wanted,
    );
    if (candidates.length === 0) continue;

    const pick =
      candidates.find((c) => c.id === preferChannelId) ??
      candidates[randomInt(candidates.length)];
    if (!pick) continue;

    const { status } = await minerRequest('channels/select', {
      method: 'POST',
      body: { channel_id: pick.id },
    });
    if (status < 400) return { game: name, channel: pick.name };
  }

  // Sin canal a tiempo el minero sigue buscando por su cuenta: no es un fallo.
  return { game: name, channel: null };
}

/**
 * Mina drops en el canal de una persona concreta: toma el juego al que está
 * jugando y fija ese canal. Si su emisión no tiene los drops activos, el minero
 * no puede acreditarlos ahí y se cae a otro canal del mismo juego; se avisa.
 */
export async function startChannelDrops(
  raw: string,
): Promise<{ login: string; game: string; channel: string | null; pinned: boolean }> {
  const login = normaliseLogin(raw);
  if (!login) throw new ControlError('Escribe el nombre del canal o pega su enlace');

  let live;
  try {
    live = await getLiveStream(login);
  } catch (err) {
    if (err instanceof TwitchLookupError) {
      throw new ControlError(err.message, err.notFound ? 404 : 502);
    }
    throw err;
  }
  if (!live) throw new ControlError(`${login} no está emitiendo ahora mismo`, 409);
  if (!live.gameName) {
    throw new ControlError(`Twitch no dice a qué está jugando ${live.login}`, 409);
  }

  let result;
  try {
    result = await startGame(live.gameName, live.channelId);
  } catch (err) {
    if (err instanceof ControlError && (err.status === 404 || err.status === 409)) {
      throw new ControlError(
        `${live.login} está jugando a ${live.gameName}, que no tiene drops que puedas minar`,
        409,
      );
    }
    throw err;
  }

  return {
    login: live.login,
    game: result.game,
    channel: result.channel,
    pinned: result.channel?.toLowerCase() === live.login.toLowerCase(),
  };
}

export async function setPower(
  on: boolean,
): Promise<{ on: boolean; game: string | null; channel: string | null }> {
  if (!on) {
    await stopMining();
    return { on: false, game: null, channel: null };
  }

  // Encender restaura lo último elegido. No mira al canal seguido: los drops y
  // el seguimiento son independientes.
  const state = await getAutomationState();
  const [memorized] = state.targetGames ?? [];
  if (!memorized) {
    throw new ControlError('No hay ningún juego memorizado: elige uno en la pestaña Drops', 409);
  }
  const result = await startGame(memorized);
  return { on: true, ...result };
}

export async function selectChannel(channelId: number): Promise<{ channel: string }> {
  const { data } = await minerRequest<{ channels?: MinerChannel[] }>('channels');
  const channel = data?.channels?.find((c) => c.id === channelId);
  if (!channel) throw new ControlError('Ese canal ya no está en la lista del minero', 404);
  if (!channel.online) throw new ControlError(`${channel.name} ya no está emitiendo`, 409);

  await minerPost('channels/select', { channel_id: channelId });
  return { channel: channel.name };
}

export async function exitManual(): Promise<{ alreadyAuto: boolean }> {
  const data = await minerPost<{ success?: boolean }>('mode/exit-manual');
  // El minero contesta 200 con success:false cuando ya elegía canal solo; antes
  // eso se tomaba por éxito y el botón parecía no hacer nada.
  return { alreadyAuto: data?.success === false };
}

// ─── Seguimiento ─────────────────────────────────────────────────────────────

export async function setAutomationEnabled(enabled: boolean): Promise<void> {
  await getAutomationState();
  await patchAutomationState({ autoEnabled: enabled });
}

/** «Viendo ahora» a mano. Toma el control hasta la próxima emisión. */
export async function setViewer(on: boolean): Promise<{ on: boolean; channel: string | null }> {
  const state = await getAutomationState();
  if (on && !state.preferredChannelName) {
    throw new ControlError('Escribe primero el canal que quieres seguir', 409);
  }
  await patchAutomationState({
    viewerOn: on,
    viewerLastNote: on ? 'Encendido, el primer minuto sale en menos de uno' : 'Apagado a mano',
    viewerLastAt: new Date(),
  });
  await takeManualControl(state);
  return { on, channel: state.preferredChannelName };
}

/** Acepta el nombre del canal o su enlace completo. */
export function normaliseLogin(raw: string): string {
  return raw
    .trim()
    .replace(/^.*twitch\.tv\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
}

export async function followChannel(raw: string): Promise<{ login: string; live: boolean }> {
  const login = normaliseLogin(raw);
  if (!login) throw new ControlError('Escribe el nombre del canal o pega su enlace');

  let live;
  try {
    live = await getLiveStream(login);
  } catch (err) {
    if (err instanceof TwitchLookupError) {
      throw new ControlError(err.message, err.notFound ? 404 : 502);
    }
    throw err;
  }

  const state = await getAutomationState();
  const changed = (state.preferredChannelName ?? '').toLowerCase() !== login;

  await patchAutomationState({
    preferredChannelName: login,
    ...(live ? { preferredChannelId: live.channelId } : {}),
    // Sólo un canal distinto invalida la sesión. Antes guardar el mismo canal, o
    // armar el interruptor que lo reenviaba, borraba `joined_at` a mitad de
    // emisión y el temporizador volvía a entrar.
    ...(changed
      ? {
          sessionKey: null,
          sessionStartedAt: null,
          joinAfterMin: null,
          leaveAfterMin: null,
          joinedAt: null,
          finishedAt: null,
          viewerSessionKey: null,
          viewerMinutes: 0,
        }
      : {}),
  });

  return { login, live: live !== null };
}
