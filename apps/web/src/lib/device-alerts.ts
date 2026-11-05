import 'server-only';

import { count, eq, inArray } from 'drizzle-orm';

import { getDb, devices, households, pushSubscriptions, thermostats } from '@pradomotica/db';
import { getClimateEntityStates, getEntityStates, type HaClimateState } from './ha';
import { isPrinterConfigured, getQueueSnapshot, listJobs } from './printer';
import { ACTIVE_JOB_STATES, type PrintJobState } from './printer-types';
import { sendPushToHousehold, type PushCategory } from './push';
import { THERMOSTAT_STALE_AFTER_MS } from './thermostat-health';

/**
 * Avisos de la casa que no son de cámara.
 *
 * Home Assistant no nos empuja nada: hay que sondear. Cada pasada lee el estado
 * de luces y climatización, lo compara con lo último que vio y manda un aviso
 * sólo cuando hay cambio de verdad. El estado anterior vive en memoria a
 * propósito: al reiniciar no hay nada con lo que comparar, y la primera pasada
 * se limita a tomar la foto inicial sin avisar de nada. Guardarlo en base de
 * datos no daría nada mejor — un aviso de hace media hora no sirve — y sí
 * costaría una escritura por aparato cada medio minuto.
 *
 * El otro lado de esto es que la memoria es de ESTE proceso. Con un solo
 * servidor Next (lo que hay en la Raspberry) es exacto; si algún día hubiera
 * varios, cada uno avisaría por su cuenta y habría duplicados.
 */

// ---------- Silencio tras manejarlo desde la app ------------------------------

/**
 * Lo que enciendes tú desde la app no te devuelve una notificación al móvil.
 *
 * Ventana generosa a propósito: entre la llamada a Home Assistant y el momento
 * en que un enchufe Tuya reporta su estado nuevo pasan varios segundos, y
 * encima el sondeo puede caer justo después. Con menos margen, media pulsación
 * de cada dos se colaría como si viniera de fuera.
 */
const SUPPRESS_MS = 90_000;

const suppressedUntil = new Map<string, number>();

/** Lo llaman las server actions justo después de mandar la orden a HA. */
export function suppressDeviceAlerts(deviceId: string): void {
  suppressedUntil.set(deviceId, Date.now() + SUPPRESS_MS);
}

/** ¿Viene este cambio de una orden reciente de la app? */
export function isAlertSuppressed(deviceId: string): boolean {
  const until = suppressedUntil.get(deviceId);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    suppressedUntil.delete(deviceId);
    return false;
  }
  return true;
}

// ---------- Foto anterior -----------------------------------------------------

interface LightSnapshot {
  kind: 'light';
  on: boolean;
}

interface ClimateSnapshot {
  kind: 'climate';
  power: boolean;
  target: number | null;
}

const lastSeen = new Map<string, LightSnapshot | ClimateSnapshot>();

/** Cambio de consigna que merece un aviso. Por debajo es ruido de redondeo. */
const TARGET_STEP_C = 0.5;

function isPowered(state: string | undefined): boolean {
  return !!state && state !== 'off' && state !== 'unavailable' && state !== 'unknown';
}

/** ¿Es una lectura en la que se puede confiar para comparar? */
function isUsable(state: string | undefined): boolean {
  return !!state && state !== 'unavailable' && state !== 'unknown';
}

function formatTemperature(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1).replace(/\.0$/, '')} °C`;
}

// ---------- Termostato sin señales --------------------------------------------

/**
 * Un termostato que deja de responder no lo dice por sí solo. Si falla la nube,
 * HA conserva el último estado: en octubre de 2026 lo enseñó seis días como si
 * fuera de ahora, con las rutinas fallando cada día sin que nadie se enterara.
 * Si falla el aparato o la red, HA lo marca no disponible. Se avisa una vez
 * cuando deja de responder y otra cuando vuelve; tras un reinicio, uno que
 * siga callado vuelve a avisar, porque lo ya avisado vive en memoria.
 *
 * Va sin el interruptor de avisos del aparato: ése silencia los cambios de
 * consigna, que con rutinas son a diario, y no debe llevarse por delante el
 * único aviso de que las rutinas han dejado de llegar.
 */

/** Un corte de wifi de unos minutos no es una avería: tuya-local se reconecta solo. */
const UNAVAILABLE_AFTER_MS = 30 * 60 * 1000;

const unavailableSince = new Map<string, number>();
const silentAlerted = new Set<string>();

function isSilent(deviceId: string, state: HaClimateState | undefined, nowMs: number): boolean {
  if (state && isUsable(state.state)) {
    unavailableSince.delete(deviceId);
    const reported = state.reportedAt ? Date.parse(state.reportedAt) : NaN;
    return Number.isFinite(reported) && nowMs - reported > THERMOSTAT_STALE_AFTER_MS;
  }
  // No disponible, o sin lectura porque HA no contesta (y entonces las rutinas
  // tampoco corren): se cuenta desde la primera vez que se vio así.
  const since = unavailableSince.get(deviceId) ?? nowMs;
  unavailableSince.set(deviceId, since);
  return nowMs - since > UNAVAILABLE_AFTER_MS;
}

function thermostatHealthAlert(
  row: { id: string; name: string; householdId: string },
  state: HaClimateState | undefined,
  nowMs: number,
): PendingAlert | null {
  const silent = isSilent(row.id, state, nowMs);
  if (silent === silentAlerted.has(row.id)) return null;
  if (silent) silentAlerted.add(row.id);
  else silentAlerted.delete(row.id);

  return {
    householdId: row.householdId,
    category: 'heating',
    payload: {
      title: silent ? '⚠️ El termostato no responde' : '✅ El termostato vuelve a responder',
      body: silent
        ? `"${row.name}" no da señales. Puede que las rutinas y las órdenes desde la app no le lleguen.`
        : `"${row.name}" vuelve a dar señales.`,
      url: '/dashboard/heating',
      tag: `climate-health:${row.id}`,
    },
  };
}

// ---------- Luces y climatización ---------------------------------------------

export interface DeviceAlertTickResult {
  sent: number;
}

interface PendingAlert {
  householdId: string;
  /** Sin él no se mira el interruptor de avisos del aparato, sólo el de la categoría. */
  deviceId?: string;
  category: PushCategory;
  payload: Parameters<typeof sendPushToHousehold>[1];
}

/**
 * ¿Hay alguien a quien avisar?
 *
 * Sin ningún dispositivo dado de alta, sondear no sirve de nada, y son unas
 * cuantas peticiones a Home Assistant cada medio minuto en una Raspberry que va
 * justa. Una cuenta indexada es mucho más barata que eso.
 */
async function hasAnySubscriber(): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(pushSubscriptions);
  return (row?.n ?? 0) > 0;
}

export async function runDeviceAlertTick(): Promise<DeviceAlertTickResult> {
  const db = getDb();

  if (!(await hasAnySubscriber())) {
    // Se tira la foto anterior: si alguien se da de alta dentro de dos horas,
    // comparar con lo que había entonces sólo daría un aviso falso.
    lastSeen.clear();
    unavailableSince.clear();
    silentAlerted.clear();
    return { sent: 0 };
  }

  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      type: devices.type,
      householdId: devices.householdId,
      haEntityId: devices.haEntityId,
      thermostatScale: thermostats.temperatureScale,
    })
    .from(devices)
    .leftJoin(thermostats, eq(thermostats.deviceId, devices.id))
    .where(inArray(devices.type, ['light', 'thermostat', 'ac']));

  const controllable = rows.filter((r) => !!r.haEntityId);
  const lightRows = controllable.filter((r) => r.type === 'light');
  const climateRows = controllable.filter((r) => r.type === 'thermostat' || r.type === 'ac');

  const [lightStates, climateStates] = await Promise.all([
    getEntityStates(lightRows.map((r) => r.haEntityId!)),
    getClimateEntityStates(climateRows.map((r) => r.haEntityId!)),
  ]);

  const pending: PendingAlert[] = [];
  const nowMs = Date.now();

  for (const row of lightRows) {
    const state = lightStates[row.haEntityId!];
    // Sin lectura fiable no se compara: un corte del WiFi del enchufe no es
    // que alguien haya apagado la luz.
    if (!isUsable(state)) continue;

    const now: LightSnapshot = { kind: 'light', on: state === 'on' };
    const before = lastSeen.get(row.id);
    lastSeen.set(row.id, now);

    if (!before || before.kind !== 'light') continue; // Primera foto: sólo se guarda.
    if (before.on === now.on) continue;
    if (isAlertSuppressed(row.id)) continue;

    pending.push({
      householdId: row.householdId,
      deviceId: row.id,
      category: 'lights',
      payload: {
        title: now.on ? '💡 Luz encendida' : '🌙 Luz apagada',
        body: `"${row.name}" se ha ${now.on ? 'encendido' : 'apagado'} sin usar la app.`,
        url: '/dashboard/lights',
        tag: `light:${row.id}`,
      },
    });
  }

  for (const row of climateRows) {
    const state: HaClimateState | undefined = climateStates[row.haEntityId!];

    if (row.type === 'thermostat') {
      const health = thermostatHealthAlert(row, state, nowMs);
      if (health) pending.push(health);
    }

    if (!state || !isUsable(state.state)) continue;

    const heat = row.type === 'thermostat';
    // La consigna se corrige con la escala del termostato, igual que en su
    // pantalla: sin eso un BHT-003 avisaría de "3.6 °C".
    const scale = heat ? (row.thermostatScale ?? 1) : 1;
    const target =
      state.targetTemperature === null
        ? null
        : Number((state.targetTemperature * scale).toFixed(1));

    const now: ClimateSnapshot = { kind: 'climate', power: isPowered(state.state), target };
    const before = lastSeen.get(row.id);
    lastSeen.set(row.id, now);

    if (!before || before.kind !== 'climate') continue;

    const category: PushCategory = heat ? 'heating' : 'ac';
    const emoji = heat ? '🔥' : '❄️';
    const on = heat ? 'Calefacción encendida' : 'Aire acondicionado encendido';
    const off = heat ? 'Calefacción apagada' : 'Aire acondicionado apagado';

    if (before.power !== now.power) {
      if (isAlertSuppressed(row.id)) continue;
      pending.push({
        householdId: row.householdId,
        deviceId: row.id,
        category,
        payload: {
          title: `${emoji} ${now.power ? on : off}`,
          body: now.power
            ? `"${row.name}" se ha encendido${target === null ? '' : ` con la consigna en ${formatTemperature(target)}`}.`
            : `"${row.name}" se ha apagado.`,
          url: heat ? '/dashboard/heating' : '/dashboard/ac',
          tag: `climate:${row.id}`,
        },
      });
      continue;
    }

    // Un horario que cambia la consigna sin apagar el aparato: el cambio que
    // más cuesta ver desde dentro de casa y el que más interesa saber.
    if (
      now.power &&
      now.target !== null &&
      before.target !== null &&
      Math.abs(now.target - before.target) >= TARGET_STEP_C
    ) {
      if (isAlertSuppressed(row.id)) continue;
      pending.push({
        householdId: row.householdId,
        deviceId: row.id,
        category,
        payload: {
          title: `${emoji} Consigna cambiada`,
          body: `"${row.name}" ha pasado de ${formatTemperature(before.target)} a ${formatTemperature(now.target)}.`,
          url: heat ? '/dashboard/heating' : '/dashboard/ac',
          tag: `climate:${row.id}`,
        },
      });
    }
  }

  await Promise.allSettled(
    pending.map((p) => sendPushToHousehold(p.householdId, p.payload, p.category, p.deviceId)),
  );

  return { sent: pending.length };
}

// ---------- Impresora ---------------------------------------------------------

/**
 * Motivos de CUPS que valen un aviso, con su texto. Los demás (por ejemplo
 * `paused`, que sale al detener la cola desde la propia app) se ignoran para no
 * avisar de lo que el usuario acaba de hacer.
 */
const PRINTER_REASONS: Record<string, string> = {
  'media-empty': 'Se ha quedado sin papel.',
  'media-needed': 'Hay que poner papel.',
  'media-jam': 'Papel atascado.',
  'cover-open': 'La tapa está abierta.',
  'door-open': 'La puerta está abierta.',
  'marker-supply-empty': 'Se ha acabado la tinta.',
  'marker-supply-low': 'Queda poca tinta.',
  'toner-empty': 'Se ha acabado el tóner.',
  'toner-low': 'Queda poco tóner.',
  'offline': 'No responde.',
  'connecting-to-device': 'No consigue conectar con la impresora.',
  'timed-out': 'La impresora no contesta.',
};

const printerSeen = {
  /** Estado con el que vimos cada trabajo por última vez. */
  jobs: new Map<number, PrintJobState>(),
  /** Motivos de la cola ya avisados, para no repetirlos en cada pasada. */
  reasons: new Set<string>(),
  seeded: false,
};

/** Nombre del trabajo recortado: los móviles ponen rutas larguísimas. */
function jobLabel(name: string): string {
  const clean = name.trim() || 'Documento';
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

/**
 * Cuánto puede llevar terminado un trabajo para que aún valga avisar.
 *
 * Es un cinturón de seguridad: CUPS enseña su histórico, así que si por lo que
 * sea un trabajo antiguo aparece como nunca visto (el proceso lleva rato
 * levantado y otros más nuevos han salido de la lista), no se anuncia como
 * recién impreso.
 */
const JOB_RECENT_MS = 15 * 60 * 1000;

function isRecentJob(stamp: string | null, nowMs: number): boolean {
  if (!stamp) return true; // Sin fecha no se descarta nada.
  const t = Date.parse(stamp);
  return !Number.isFinite(t) || nowMs - t < JOB_RECENT_MS;
}

export async function runPrinterAlertTick(): Promise<DeviceAlertTickResult> {
  if (!isPrinterConfigured()) return { sent: 0 };
  if (!(await hasAnySubscriber())) {
    printerSeen.jobs.clear();
    printerSeen.reasons.clear();
    printerSeen.seeded = false;
    return { sent: 0 };
  }

  const db = getDb();
  const [jobs, queue, homes] = await Promise.all([
    listJobs(25),
    getQueueSnapshot().catch(() => null),
    db.select({ id: households.id }).from(households),
  ]);

  const payloads: Parameters<typeof sendPushToHousehold>[1][] = [];
  const nowMs = Date.now();

  for (const job of jobs) {
    const before = printerSeen.jobs.get(job.id);
    printerSeen.jobs.set(job.id, job.state);

    // Primera pasada tras arrancar: la cola ya trae el histórico de CUPS y no
    // tiene ningún sentido avisar de trabajos terminados hace días.
    if (!printerSeen.seeded) continue;
    if (before === job.state) continue;
    // De un trabajo que nunca habíamos visto sólo se avisa si acaba de pasar.
    if (before === undefined && !isRecentJob(job.completedAt ?? job.createdAt, nowMs)) continue;

    if (job.state === 'completed') {
      payloads.push({
        title: '🖨️ Impresión terminada',
        body: `"${jobLabel(job.name)}" se ha imprimido${job.sheets ? ` (${job.sheets} ${job.sheets === 1 ? 'hoja' : 'hojas'})` : ''}.`,
        url: '/dashboard/printer',
        tag: `print-job:${job.id}`,
      });
    } else if (job.state === 'aborted' || job.state === 'stopped') {
      const reason = job.reasons.map((r) => PRINTER_REASONS[r]).find(Boolean);
      payloads.push({
        title: '⚠️ Problema al imprimir',
        body: `"${jobLabel(job.name)}" se ha detenido. ${reason ?? job.message ?? 'Revisa la impresora.'}`,
        url: '/dashboard/printer',
        tag: `print-job:${job.id}`,
      });
    }
    // 'canceled' no avisa: lo cancela una persona, y ya lo sabe.
  }

  if (queue) {
    const relevant = queue.reasons.filter((r) => r in PRINTER_REASONS);
    // Un motivo suelto sin nada que imprimir no es urgente (una impresora
    // dormida se declara "offline" a todas horas): sólo se avisa si hay cola.
    const hasWork = jobs.some((j) => ACTIVE_JOB_STATES.includes(j.state));

    if (!printerSeen.seeded || hasWork) {
      if (printerSeen.seeded) {
        for (const reason of relevant.filter((r) => !printerSeen.reasons.has(r))) {
          payloads.push({
            title: '⚠️ La impresora necesita atención',
            body: PRINTER_REASONS[reason]!,
            url: '/dashboard/printer',
            tag: `printer:${reason}`,
          });
        }
      }
      printerSeen.reasons = new Set(relevant);
    } else {
      // Sin cola no se avisa, pero tampoco se da por avisado: sólo se olvidan
      // los motivos que ya no están, para que un "sin papel" que sigue puesto
      // no vuelva a sonar y uno que reaparezca con trabajo sí lo haga.
      printerSeen.reasons = new Set(relevant.filter((r) => printerSeen.reasons.has(r)));
    }
  }

  printerSeen.seeded = true;

  // La cola de CUPS es una sola para toda la instalación, no de un hogar
  // concreto: el aviso va a todos los hogares que haya dados de alta.
  if (payloads.length > 0) {
    await Promise.allSettled(
      homes.flatMap((h) => payloads.map((p) => sendPushToHousehold(h.id, p, 'printer'))),
    );
  }

  // La memoria no crece sin fin: CUPS recicla los números de trabajo, así que
  // basta con quedarse con los que la cola sigue enseñando.
  if (printerSeen.jobs.size > 200) {
    const live = new Set(jobs.map((j) => j.id));
    for (const id of printerSeen.jobs.keys()) {
      if (!live.has(id)) printerSeen.jobs.delete(id);
    }
  }

  return { sent: payloads.length * homes.length };
}
