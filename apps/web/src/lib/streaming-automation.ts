import 'server-only';
import { randomInt } from 'node:crypto';
import { and, eq, isNull, ne, or } from 'drizzle-orm';

import { getDb, streamingMinerSnapshot } from '@pradomotica/db';
import { getLiveStream, TwitchLookupError } from './twitch-live';
import { minerRequest, MinerUnavailableError, type MinerChannel } from './twitch-miner';

/**
 * Automatiza «Viendo ahora», el visor propio del canal seguido, para que el
 * patrón no cante.
 *
 * Reglas, sorteadas UNA vez por emisión y guardadas en BD:
 *  - Encender en un instante al azar entre la primera y la segunda hora.
 *  - Apagar en un instante al azar entre la cuarta y la quinta hora.
 *  - Apagar antes si el canal cierra la emisión.
 *
 * No toca el minero de drops: seguir a alguien y minar drops son cosas
 * independientes. Antes esta automatización encendía el minero con el juego del
 * canal seguido, así que no se podía ver a esa persona si no jugaba a algo con
 * drops, ni minar drops de otro juego mientras tanto.
 *
 * El sorteo se persiste a propósito. Si se resortease en cada comprobación, la
 * probabilidad efectiva dependería de la frecuencia del temporizador y un
 * reinicio del contenedor movería la hora elegida a mitad de emisión.
 *
 * Entrar y salir se reclaman con un UPDATE condicionado, no leyendo y luego
 * escribiendo: el temporizador y el botón «Comprobar ahora» pueden coincidir, y
 * con lectura previa ambos veían `joined_at` a null y entraban dos veces.
 */

const ROW_ID = 'default';

const JOIN_WINDOW_MIN = [60, 120] as const;
const LEAVE_WINDOW_MIN = [240, 300] as const;

/** Reintentos al fijar canal: el minero tarda un poco en descubrirlo. */
const SELECT_ATTEMPTS = 3;
const SELECT_DELAY_MS = 2000;

export type AutomationState = typeof streamingMinerSnapshot.$inferSelect;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lee la fila única, creándola vacía la primera vez. */
export async function getAutomationState(): Promise<AutomationState> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(streamingMinerSnapshot)
    .where(eq(streamingMinerSnapshot.id, ROW_ID))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(streamingMinerSnapshot)
    .values({ id: ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Otra petición la creó entre medias.
  const [raced] = await db
    .select()
    .from(streamingMinerSnapshot)
    .where(eq(streamingMinerSnapshot.id, ROW_ID))
    .limit(1);
  if (!raced) throw new Error('No se pudo crear el estado del minero');
  return raced;
}

export async function patchAutomationState(
  values: Partial<AutomationState>,
): Promise<AutomationState> {
  const db = getDb();
  const [row] = await db
    .update(streamingMinerSnapshot)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(streamingMinerSnapshot.id, ROW_ID))
    .returning();
  if (!row) throw new Error('El estado del minero desapareció al actualizarlo');
  return row;
}

/** Marca la entrada de la sesión. False si otra comprobación ya la marcó. */
async function claimJoin(sessionKey: string, at: Date): Promise<boolean> {
  const rows = await getDb()
    .update(streamingMinerSnapshot)
    .set({ joinedAt: at, viewerOn: true, updatedAt: at })
    .where(
      and(
        eq(streamingMinerSnapshot.id, ROW_ID),
        eq(streamingMinerSnapshot.sessionKey, sessionKey),
        isNull(streamingMinerSnapshot.joinedAt),
        isNull(streamingMinerSnapshot.finishedAt),
      ),
    )
    .returning({ id: streamingMinerSnapshot.id });
  return rows.length > 0;
}

/** Marca el cierre de la sesión. False si otra comprobación ya lo marcó. */
async function claimFinish(sessionKey: string, at: Date, stopViewer: boolean): Promise<boolean> {
  const rows = await getDb()
    .update(streamingMinerSnapshot)
    .set({ finishedAt: at, ...(stopViewer ? { viewerOn: false } : {}), updatedAt: at })
    .where(
      and(
        eq(streamingMinerSnapshot.id, ROW_ID),
        eq(streamingMinerSnapshot.sessionKey, sessionKey),
        isNull(streamingMinerSnapshot.finishedAt),
      ),
    )
    .returning({ id: streamingMinerSnapshot.id });
  return rows.length > 0;
}

// ─── Encendido y apagado del minero de drops ─────────────────────────────────

/** True si el minero está vigilando algún juego ahora mismo. */
export async function isMining(): Promise<boolean> {
  const { data } = await minerRequest<{ games_to_watch?: string[] }>('settings');
  return (data?.games_to_watch?.length ?? 0) > 0;
}

/**
 * Apaga: memoriza qué vigilaba y vacía la lista de juegos. El contenedor sigue
 * vivo y con la sesión de Twitch abierta, pero deja de acumular minutos.
 */
export async function stopMining(): Promise<void> {
  const { data } = await minerRequest<{ games_to_watch?: string[] }>('settings');
  const games = data?.games_to_watch ?? [];

  // Sólo pisamos el recuerdo si había algo que recordar: apagar dos veces
  // seguidas no debe borrar el juego memorizado.
  if (games.length > 0) {
    await patchAutomationState({ targetGames: games });
  }

  await minerRequest('settings', { method: 'POST', body: { games_to_watch: [] } });
}

/**
 * Enciende vigilando `games`, y fija `channelId` si llega a estar disponible.
 * Devuelve si consiguió fijar ese canal concreto.
 */
export async function startMining(games: string[], channelId?: number | null): Promise<boolean> {
  if (games.length === 0) throw new Error('No hay ningún juego que vigilar');

  await patchAutomationState({ targetGames: games });
  await minerRequest('settings', { method: 'POST', body: { games_to_watch: games } });

  if (!channelId) return false;

  // El minero puebla su lista de canales al cambiar el juego vigilado, así que
  // el canal no existe para él hasta un instante después.
  for (let i = 0; i < SELECT_ATTEMPTS; i++) {
    await sleep(SELECT_DELAY_MS);
    try {
      const { data } = await minerRequest<{ channels?: MinerChannel[] }>('channels');
      const match = data?.channels?.find((c) => c.id === channelId && c.online);
      if (!match) continue;
      await minerRequest('channels/select', {
        method: 'POST',
        body: { channel_id: channelId },
      });
      return true;
    } catch (err) {
      if (err instanceof MinerUnavailableError) throw err;
    }
  }
  // Sin canal fijado sigue minando en automático, que es mejor que nada.
  return false;
}

// ─── El tick de la automatización ────────────────────────────────────────────

export interface TickResult {
  action: 'none' | 'started' | 'stopped' | 'skipped';
  note: string;
  /** Minutos que lleva la emisión, si está en directo. */
  elapsedMin?: number;
  joinAfterMin?: number | null;
  leaveAfterMin?: number | null;
}

/**
 * Una comprobación. Pensada para llamarse cada pocos minutos.
 * Nunca lanza por un fallo puntual de red: lo anota y deja el estado como
 * estaba, porque cortar una sesión buena por un timeout sería peor.
 */
export async function runAutomationTick(): Promise<TickResult> {
  const state = await getAutomationState();

  const finish = async (result: TickResult): Promise<TickResult> => {
    await patchAutomationState({ lastTickAt: new Date(), lastTickNote: result.note });
    return result;
  };

  if (!state.autoEnabled) {
    return finish({ action: 'skipped', note: 'Automatización desactivada' });
  }
  if (!state.preferredChannelName) {
    return finish({ action: 'skipped', note: 'Falta indicar a quién seguir' });
  }

  let live;
  try {
    live = await getLiveStream(state.preferredChannelName);
  } catch (err) {
    const reason = err instanceof TwitchLookupError ? err.message : String(err);
    // Un fallo de consulta NO es una emisión apagada. Se deja todo como está.
    return finish({ action: 'none', note: `No se pudo consultar Twitch: ${reason}` });
  }

  const now = new Date();

  // ── El canal está apagado ──────────────────────────────────────────────────
  if (!live) {
    // Sólo se apaga lo que encendió la automatización. Si se tomó el control a
    // mano (`finishedAt` puesto sin haber entrado), se respeta.
    const wasWatching = state.joinedAt !== null && state.finishedAt === null;
    await patchAutomationState({
      sessionKey: null,
      sessionStartedAt: null,
      joinAfterMin: null,
      leaveAfterMin: null,
      joinedAt: null,
      finishedAt: null,
      ...(wasWatching ? { viewerOn: false } : {}),
    });
    return finish({
      action: wasWatching ? 'stopped' : 'none',
      note: wasWatching
        ? `${state.preferredChannelName} cerró la emisión, «Viendo ahora» apagado`
        : `${state.preferredChannelName} no está emitiendo`,
    });
  }

  // ── Emisión nueva: se sortean los tramos ───────────────────────────────────
  // Condicionado a que la sesión guardada sea otra, para que dos comprobaciones
  // simultáneas no sorteen dos veces y la hora mostrada salte.
  let current = state;
  if (state.sessionKey !== live.streamId) {
    const [opened] = await getDb()
      .update(streamingMinerSnapshot)
      .set({
        sessionKey: live.streamId,
        sessionStartedAt: live.startedAt,
        // randomInt excluye el límite superior, de ahí el +1.
        joinAfterMin: randomInt(JOIN_WINDOW_MIN[0], JOIN_WINDOW_MIN[1] + 1),
        leaveAfterMin: randomInt(LEAVE_WINDOW_MIN[0], LEAVE_WINDOW_MIN[1] + 1),
        joinedAt: null,
        finishedAt: null,
        preferredChannelId: live.channelId,
        updatedAt: now,
      })
      .where(
        and(
          eq(streamingMinerSnapshot.id, ROW_ID),
          or(
            isNull(streamingMinerSnapshot.sessionKey),
            ne(streamingMinerSnapshot.sessionKey, live.streamId),
          ),
        ),
      )
      .returning();
    current = opened ?? (await getAutomationState());
  }

  const sessionKey = live.streamId;
  const startedAt = current.sessionStartedAt ?? live.startedAt;
  const elapsedMin = Math.floor((now.getTime() - startedAt.getTime()) / 60000);
  const joinAfter = current.joinAfterMin ?? JOIN_WINDOW_MIN[1];
  const leaveAfter = current.leaveAfterMin ?? LEAVE_WINDOW_MIN[1];
  const common = { elapsedMin, joinAfterMin: joinAfter, leaveAfterMin: leaveAfter };

  if (current.finishedAt) {
    return finish({
      ...common,
      action: 'none',
      note: 'Emisión ya atendida o tomada a mano, se espera a la siguiente',
    });
  }

  // ── Toca salir ─────────────────────────────────────────────────────────────
  if (elapsedMin >= leaveAfter) {
    if (!current.joinedAt) {
      // Llegamos tarde a esta emisión: encender para apagar acto seguido no
      // tiene sentido, así que la damos por cerrada sin tocar el visor.
      await claimFinish(sessionKey, now, false);
      return finish({
        ...common,
        action: 'none',
        note: `La emisión ya pasaba de ${Math.floor(leaveAfter / 60)} h al armar, se deja pasar`,
      });
    }
    // Quien pierde la carrera no anota nada: la nota buena es la del ganador.
    if (!(await claimFinish(sessionKey, now, true))) {
      return { ...common, action: 'none', note: 'Otra comprobación ya se encargó de salir' };
    }
    return finish({
      ...common,
      action: 'stopped',
      note: `«Viendo ahora» apagado a las ${Math.floor(elapsedMin / 60)} h ${elapsedMin % 60} min de emisión`,
    });
  }

  // ── Toca entrar ────────────────────────────────────────────────────────────
  if (!current.joinedAt && elapsedMin >= joinAfter) {
    if (!(await claimJoin(sessionKey, now))) {
      return { ...common, action: 'none', note: 'Otra comprobación ya se encargó de entrar' };
    }
    return finish({
      ...common,
      action: 'started',
      note: `«Viendo ahora» encendido para ${live.login} a los ${elapsedMin} min de emisión`,
    });
  }

  // ── Ni una cosa ni la otra ─────────────────────────────────────────────────
  return finish({
    ...common,
    action: 'none',
    note: current.joinedAt
      ? `Viendo, se apagará a los ${leaveAfter} min (van ${elapsedMin})`
      : `Esperando a los ${joinAfter} min de emisión (van ${elapsedMin})`,
  });
}
