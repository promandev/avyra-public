import 'server-only';

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import { getDb, devices, vacuums, vacuumSessions } from '@pradomotica/db';
import { isAlertSuppressed } from './device-alerts';
import { getRawEntityState } from './ha';
import { newId } from './id';
import { sendPushToHousehold } from './push';

/**
 * Registro de limpiezas del robot aspirador.
 *
 * Una sesión empieza cuando la entidad pasa a `cleaning` y termina cuando el
 * robot vuelve a quedar parado (`docked`, `idle`, `error`). Pausas y la vuelta
 * a la base forman parte de la misma sesión.
 *
 * Se decide por sondeo desde el propio proceso, como la automatización de
 * Streaming, porque así el registro no depende de que alguien tenga la página
 * abierta ni de exponer un webhook nuevo.
 */

/** Estados en los que la sesión sigue viva. */
const ACTIVE_STATES = new Set(['cleaning', 'returning', 'paused']);
/** Estados que cierran la sesión. */
const FINISHED_STATES = new Set(['docked', 'idle', 'error', 'off']);
/**
 * Por debajo de esto no es una limpieza. Un empujón con las flechas pone a la
 * Conga en `cleaning` unos segundos (visto en directo) y sólo ensuciaría el
 * registro.
 */
const MIN_SESSION_MS = 60_000;

/**
 * Último estado visto de cada robot, sólo para los avisos: el registro se
 * apoya en la sesión abierta, pero un `error` sin sesión (se atasca al salir de
 * la base) no abre ninguna y aun así hay que contarlo. En memoria, como el
 * resto de los avisos: tras un reinicio la primera pasada sólo toma la foto.
 */
const lastNotifiedState = new Map<string, string>();

function numericState(state: string | undefined): number | null {
  if (state === undefined || state.trim() === '') return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

async function readNumber(entityId: string | null): Promise<number | null> {
  if (!entityId) return null;
  const raw = await getRawEntityState(entityId);
  return numericState(raw?.state);
}

export interface VacuumSessionTickResult {
  opened: number;
  closed: number;
}

export async function runVacuumSessionTick(now = new Date()): Promise<VacuumSessionTickResult> {
  const db = getDb();
  const units = await db
    .select({
      id: devices.id,
      name: devices.name,
      householdId: devices.householdId,
      haEntityId: devices.haEntityId,
      batteryEntityId: vacuums.batteryEntityId,
      cleanTimeEntityId: vacuums.cleanTimeEntityId,
      cleanAreaEntityId: vacuums.cleanAreaEntityId,
    })
    .from(devices)
    .innerJoin(vacuums, eq(vacuums.deviceId, devices.id))
    .where(isNotNull(devices.haEntityId));

  const result: VacuumSessionTickResult = { opened: 0, closed: 0 };

  for (const unit of units) {
    try {
      const main = await getRawEntityState(unit.haEntityId!);
      // Sin lectura fiable no se abre ni se cierra nada: un corte de HA o del
      // WiFi del robot no debe partir una limpieza en dos.
      if (!main || main.state === 'unavailable' || main.state === 'unknown') continue;
      const state = main.state;

      const [batterySensor, minutes, area] = await Promise.all([
        readNumber(unit.batteryEntityId),
        readNumber(unit.cleanTimeEntityId),
        readNumber(unit.cleanAreaEntityId),
      ]);
      const batteryRaw =
        batterySensor ??
        (typeof main.attributes?.battery_level === 'number' ? main.attributes.battery_level : null);
      const battery = batteryRaw === null ? null : Math.round(batteryRaw);

      const previousState = lastNotifiedState.get(unit.id);
      lastNotifiedState.set(unit.id, state);
      // Con `undefined` es la primera pasada tras arrancar: no hay con qué
      // comparar, así que esta vuelta no avisa de nada.
      const stateChanged = previousState !== undefined && previousState !== state;

      // Un atasco se avisa siempre, aunque no haya sesión abierta y aunque la
      // orden venga de la app: nadie pide que el robot se atasque.
      if (stateChanged && state === 'error') {
        await sendPushToHousehold(
          unit.householdId,
          {
            title: '⚠️ El robot necesita ayuda',
            body: `"${unit.name}" se ha detenido con un error.`,
            url: '/dashboard/vacuum',
            tag: `vacuum:${unit.id}`,
          },
          'vacuum',
          unit.id,
        );
      }

      const [open] = await db
        .select()
        .from(vacuumSessions)
        .where(and(eq(vacuumSessions.deviceId, unit.id), isNull(vacuumSessions.endedAt)))
        .orderBy(desc(vacuumSessions.startedAt))
        .limit(1);

      if (!open) {
        if (state !== 'cleaning') continue;
        await db.insert(vacuumSessions).values({
          id: newId(),
          deviceId: unit.id,
          startedAt: now,
          lastActiveAt: now,
          batteryStart: battery,
          batteryEnd: battery,
          cleanMinutes: minutes,
          areaStart: area,
          cleanArea: null,
        });
        result.opened += 1;
        // El arranque que sale de la app no se devuelve al móvil; el de un
        // horario o del botón del propio robot, sí.
        if (stateChanged && !isAlertSuppressed(unit.id)) {
          await sendPushToHousehold(
            unit.householdId,
            {
              title: '🧹 Limpieza iniciada',
              body: `"${unit.name}" ha empezado a limpiar${battery === null ? '' : ` con el ${battery} % de batería`}.`,
              url: '/dashboard/vacuum',
              tag: `vacuum:${unit.id}`,
            },
            'vacuum',
            unit.id,
          );
        }
        continue;
      }

      if (ACTIVE_STATES.has(state)) {
        await db
          .update(vacuumSessions)
          .set({
            lastActiveAt: now,
            // La batería final se congela aquí, mientras aún trabaja: al llegar
            // a la base la Conga recalibra y salta de golpe (11 → 40 medido en
            // directo), así que la lectura ya cargando no refleja el gasto.
            batteryEnd: battery ?? open.batteryEnd,
            // Última lectura, no la mayor: el primer valor puede ser el de la
            // limpieza anterior si el robot tarda en poner su contador a cero.
            cleanMinutes: minutes ?? open.cleanMinutes,
          })
          .where(eq(vacuumSessions.id, open.id));
        continue;
      }

      if (FINISHED_STATES.has(state)) {
        const activeMs = open.lastActiveAt.getTime() - open.startedAt.getTime();
        if (activeMs < MIN_SESSION_MS) {
          await db.delete(vacuumSessions).where(eq(vacuumSessions.id, open.id));
          continue;
        }

        // La duración es la del intervalo que se enseña (inicio → fin), no el
        // contador del robot: la Conga sólo cuenta parte del tiempo (o lo pone
        // a cero a mitad) y salían 17 min para una limpieza de 10:49 a 11:43.
        const cleanMinutes = Math.round(activeMs / 60_000);
        // La superficie sólo cuenta si cambió durante la limpieza: la Conga
        // 1090 publica un valor fijo (123.4) que no significa nada.
        const cleanArea = area !== null && area !== open.areaStart ? area : null;

        await db
          .update(vacuumSessions)
          .set({
            // El final real es la última vez que se le vio trabajando, no este
            // tick: si la app estuvo parada, `now` podría ser horas después.
            endedAt: open.lastActiveAt,
            cleanMinutes,
            cleanArea,
            endState: state,
          })
          .where(eq(vacuumSessions.id, open.id));
        result.closed += 1;

        // El final siempre se avisa, aunque la limpieza la hayas lanzado tú:
        // es justo el momento que no puedes prever y por el que se mira la app.
        // El error ya se avisó arriba, así que aquí sólo el final limpio.
        if (state !== 'error') {
          const parts = [`${cleanMinutes} min`];
          if (cleanArea !== null) parts.push(`${cleanArea} m²`);
          // La batería congelada de la sesión, no la de ahora: en la base la
          // Conga recalibra y salta de golpe, igual que al cerrar la fila.
          if (open.batteryEnd !== null) parts.push(`batería al ${open.batteryEnd} %`);
          await sendPushToHousehold(
            unit.householdId,
            {
              title: '✅ Limpieza terminada',
              body: `"${unit.name}" ha terminado: ${parts.join(', ')}.`,
              url: '/dashboard/vacuum',
              tag: `vacuum:${unit.id}`,
            },
            'vacuum',
            unit.id,
          );
        }
      }
    } catch (err) {
      console.error(
        `[vacuum] Session tick failed for ${unit.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return result;
}
