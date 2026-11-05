import 'server-only';
import { randomBytes } from 'node:crypto';

import {
  getAutomationState,
  patchAutomationState,
  type AutomationState,
} from './streaming-automation';
import { getLiveStream, TwitchLookupError } from './twitch-live';
import { minerRequest, type MinerStatus } from './twitch-miner';
import { sendMinuteWatched } from './twitch-spade';

/**
 * Visor propio: ve al canal seguido mandando un minuto visto cada minuto, juegue
 * a lo que juegue y sin depender del minero de drops.
 *
 * Del minero sólo toma el identificador de usuario, que su API expone sin nada
 * secreto. Si el minero ya está viendo ese mismo canal no manda nada: sus
 * minutos ya cuentan, y Twitch sólo acredita dos canales a la vez, así que
 * duplicar sólo gastaría ese cupo.
 */

export interface ViewerTickResult {
  sent: boolean;
  note: string;
}

/** Canal que está viendo el minero de drops, según su texto de estado. */
function minerWatchingLogin(status: string | undefined): string | null {
  const name = /Watching:?\s+(.+?)(?:\s+for\s+.+)?$/i.exec(status ?? '')?.[1];
  return name ? name.trim().toLowerCase() : null;
}

export async function runViewerTick(): Promise<ViewerTickResult> {
  const state = await getAutomationState();
  // Apagado no escribe nada: el tick corre cada minuto y no debe ensuciar la BD.
  if (!state.viewerOn || !state.preferredChannelName) return { sent: false, note: '' };

  const finish = async (
    sent: boolean,
    note: string,
    extra: Partial<AutomationState> = {},
  ): Promise<ViewerTickResult> => {
    await patchAutomationState({ viewerLastAt: new Date(), viewerLastNote: note, ...extra });
    return { sent, note };
  };

  let minerStatus: MinerStatus | null = null;
  try {
    const { status, data } = await minerRequest<MinerStatus>('status');
    if (status < 400) minerStatus = data;
  } catch {
    // Sin minero se usa el último identificador conocido.
  }

  const userId = minerStatus?.login.user_id
    ? String(minerStatus.login.user_id)
    : state.viewerUserId;
  if (!userId) {
    return finish(false, 'Falta la sesión de Twitch: autoriza primero el minero');
  }

  let live;
  try {
    live = await getLiveStream(state.preferredChannelName);
  } catch (err) {
    const reason = err instanceof TwitchLookupError ? err.message : String(err);
    return finish(false, `No se pudo consultar Twitch: ${reason}`, { viewerUserId: userId });
  }

  if (!live) {
    return finish(false, `${state.preferredChannelName} no está emitiendo`, {
      viewerUserId: userId,
    });
  }

  const newSession = state.viewerSessionKey !== live.streamId;
  const base: Partial<AutomationState> = {
    viewerUserId: userId,
    ...(newSession ? { viewerSessionKey: live.streamId, viewerMinutes: 0 } : {}),
  };

  if (minerWatchingLogin(minerStatus?.status) === live.login.toLowerCase()) {
    return finish(false, `El minero de drops ya está viendo a ${live.login}, no se duplica`, base);
  }

  const deviceId = state.viewerDeviceId ?? randomBytes(16).toString('hex');

  let status: number;
  try {
    status = await sendMinuteWatched({ userId, deviceId, live });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return finish(false, `No se pudo enviar el minuto: ${reason}`, {
      ...base,
      viewerDeviceId: deviceId,
    });
  }

  if (status >= 300) {
    return finish(false, `Twitch rechazó el minuto (HTTP ${status})`, {
      ...base,
      viewerDeviceId: deviceId,
    });
  }

  const minutes = (newSession ? 0 : state.viewerMinutes) + 1;
  return finish(true, `Viendo a ${live.login} · ${minutes} min en esta emisión`, {
    ...base,
    viewerDeviceId: deviceId,
    viewerMinutes: minutes,
  });
}
