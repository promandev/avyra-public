import 'server-only';
import { appendFile, readFile, rename, stat, statfs, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SecurityAlert, SecurityReport, SystemMetrics } from './system-panel-types';

/**
 * Sección Sistema: lo que era el antiguo "Avyra Panel" (FastAPI en :8443)
 * metido dentro de la app.
 *
 * Las métricas salen de /proc y /sys, que dentro del contenedor muestran los
 * valores del host: Docker no aísla esos ficheros sin lxcfs. El resto (SSH,
 * registro de acciones) vive en `<PANEL_FILE_ROOT>/.avyra-panel`, dentro de la
 * carpeta del host que se monta para el explorador.
 */

/** Carpeta del host montada en el contenedor, o `null` si no está configurada. */
export function panelRoot(): string | null {
  const root = process.env.PANEL_FILE_ROOT?.trim();
  return root ? path.resolve(root) : null;
}

function dataDir(root: string): string {
  return path.join(root, '.avyra-panel');
}

// --------------------------------------------------------------------------- //
// Métricas
// --------------------------------------------------------------------------- //

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

interface CpuSample {
  idle: number;
  total: number;
  at: number;
}

async function sampleCpu(): Promise<CpuSample | null> {
  const stat = await readOptional('/proc/stat');
  const line = stat?.split('\n', 1)[0];
  if (!line?.startsWith('cpu ')) return null;
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  // idle + iowait: el tiempo que la CPU no estuvo trabajando.
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
  const total = fields.reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
  return { idle, total, at: Date.now() };
}

/**
 * El % de CPU es una diferencia entre dos lecturas. Se guarda la anterior entre
 * peticiones para no tener que esperar en cada sondeo; si es muy vieja (nadie
 * ha mirado la sección en un rato) se toman dos muestras seguidas.
 */
let lastCpu: CpuSample | null = null;
const CPU_SAMPLE_MAX_AGE_MS = 60_000;

async function cpuPercent(): Promise<number | null> {
  let previous = lastCpu;
  if (!previous || Date.now() - previous.at > CPU_SAMPLE_MAX_AGE_MS) {
    previous = await sampleCpu();
    if (!previous) return null;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const current = await sampleCpu();
  if (!current) return null;
  lastCpu = current;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  if (total <= 0) return 0;
  return Math.round(((total - idle) / total) * 1000) / 10;
}

function meminfoValue(text: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text);
  return match ? Number(match[1]) * 1024 : null;
}

function usage(totalBytes: number, usedBytes: number) {
  return {
    totalBytes,
    usedBytes,
    percent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
  };
}

export async function collectMetrics(): Promise<SystemMetrics> {
  const root = panelRoot();
  const [percent, meminfo, loadavg, uptime, temp, fsStats] = await Promise.all([
    cpuPercent(),
    readOptional('/proc/meminfo'),
    readOptional('/proc/loadavg'),
    readOptional('/proc/uptime'),
    readOptional('/sys/class/thermal/thermal_zone0/temp'),
    statfs(root ?? '/').catch(() => null),
  ]);

  let memory: SystemMetrics['memory'] = null;
  let swap: SystemMetrics['swap'] = null;
  if (meminfo) {
    const total = meminfoValue(meminfo, 'MemTotal');
    const available = meminfoValue(meminfo, 'MemAvailable');
    if (total && available !== null) memory = usage(total, total - available);
    const swapTotal = meminfoValue(meminfo, 'SwapTotal');
    const swapFree = meminfoValue(meminfo, 'SwapFree');
    if (swapTotal && swapFree !== null) swap = usage(swapTotal, swapTotal - swapFree);
  }

  const loads = loadavg?.trim().split(/\s+/).slice(0, 3).map(Number);
  const tempMilli = temp ? Number(temp.trim()) : NaN;
  const uptimeSeconds = uptime ? Math.floor(Number(uptime.trim().split(/\s+/)[0])) : NaN;

  let disk: SystemMetrics['disk'] = null;
  if (fsStats) {
    // Igual que `df`: el % se calcula sobre lo que puede usar un usuario normal.
    const used = (fsStats.blocks - fsStats.bfree) * fsStats.bsize;
    const free = fsStats.bavail * fsStats.bsize;
    disk = { ...usage(used + free, used), totalBytes: fsStats.blocks * fsStats.bsize, freeBytes: free };
  }

  return {
    cpu: {
      percent,
      cores: os.availableParallelism(),
      load: loads && loads.length === 3 && loads.every(Number.isFinite)
        ? (loads as [number, number, number])
        : null,
      temperatureC: Number.isFinite(tempMilli) ? Math.round(tempMilli / 100) / 10 : null,
    },
    memory,
    swap,
    disk,
    uptimeSeconds: Number.isFinite(uptimeSeconds) ? uptimeSeconds : null,
    generatedAt: new Date().toISOString(),
  };
}

// --------------------------------------------------------------------------- //
// Registro de acciones
// --------------------------------------------------------------------------- //

/** Pequeño a propósito: la tarjeta SD no debe llenarse con esto. */
const EVENT_LOG_MAX_BYTES = 256 * 1024;
const EVENT_LOG_BACKUPS = 2;

/**
 * Apunta una acción hecha desde la sección (subidas, borrados, ediciones…).
 * Nunca lanza: perder una línea de registro no debe romper la operación.
 */
export async function logPanelEvent(message: string): Promise<void> {
  const root = panelRoot();
  if (!root) return;
  const dir = dataDir(root);
  const file = path.join(dir, 'panel.log');
  try {
    await mkdir(dir, { recursive: true });
    const size = await stat(file).then((s) => s.size).catch(() => 0);
    if (size > EVENT_LOG_MAX_BYTES) {
      for (let i = EVENT_LOG_BACKUPS - 1; i >= 1; i--) {
        await rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => {});
      }
      await rename(file, `${file}.1`).catch(() => {});
    }
    await appendFile(file, `${new Date().toISOString()} ${message.replace(/\s+/g, ' ')}\n`);
  } catch (err) {
    console.warn('[system-panel] no se pudo escribir el registro:', err);
  }
}

async function recentEvents(root: string, max = 50): Promise<string[]> {
  const text = await readOptional(path.join(dataDir(root), 'panel.log'));
  if (!text) return [];
  return text.trimEnd().split('\n').slice(-max).reverse();
}

// --------------------------------------------------------------------------- //
// Alertas de acceso por SSH
// --------------------------------------------------------------------------- //

// Líneas de OpenSSH tal como las deja el exportador (`journalctl -o short-iso`):
//   2026-09-30T23:05:56+02:00 avyra sshd-session[1]: Accepted publickey for youruser from 1.2.3.4 port 5 ssh2
const FAILED = /Failed password for (?:invalid user )?(\S+) from ([\d.:a-fA-F]+)/;
const ACCEPTED = /Accepted (\w+) for (\S+) from ([\d.:a-fA-F]+)/;
const INVALID = /Invalid user (\S+) from ([\d.:a-fA-F]+)/;
const LINE_TIME = /^(\d{4}-\d{2}-\d{2}T\S+)/;

/** A partir de cuántos fallos desde una misma IP se considera fuerza bruta. */
const BRUTE_FORCE_THRESHOLD = 5;

function countTop(counts: Map<string, number>, n: number): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function loadKnownIps(file: string): Promise<Set<string>> {
  const text = await readOptional(file);
  if (!text) return new Set();
  try {
    const parsed: unknown = JSON.parse(text);
    return new Set(Array.isArray(parsed) ? parsed.filter((ip) => typeof ip === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Analiza el log de SSH que exporta el cron del host
 * (`infra/scripts/panel-ssh-export.sh`). La app no puede leer el journal
 * directamente: la imagen no trae `journalctl` y el journal es del host.
 */
export async function securityReport(): Promise<SecurityReport> {
  const empty: SecurityReport = {
    available: false,
    updatedAt: null,
    alerts: [],
    summary: {
      failedAttempts: 0,
      distinctAttackerIps: 0,
      successfulLogins: 0,
      topFailedIps: [],
      topFailedUsers: [],
    },
    recentAccepted: [],
    events: [],
  };
  const root = panelRoot();
  if (!root) return empty;

  const dir = dataDir(root);
  const logFile = path.join(dir, 'ssh.log');
  const [text, info, events] = await Promise.all([
    readOptional(logFile),
    stat(logFile).catch(() => null),
    recentEvents(root),
  ]);
  if (text === null) return { ...empty, events };

  const failedByIp = new Map<string, number>();
  const failedUsers = new Map<string, number>();
  const accepted: SecurityReport['recentAccepted'] = [];
  const invalid: { user: string; ip: string }[] = [];

  for (const line of text.split('\n')) {
    let m = FAILED.exec(line);
    if (m) {
      failedUsers.set(m[1]!, (failedUsers.get(m[1]!) ?? 0) + 1);
      failedByIp.set(m[2]!, (failedByIp.get(m[2]!) ?? 0) + 1);
      continue;
    }
    m = ACCEPTED.exec(line);
    if (m) {
      accepted.push({ at: LINE_TIME.exec(line)?.[1] ?? null, method: m[1]!, user: m[2]!, ip: m[3]! });
      continue;
    }
    m = INVALID.exec(line);
    if (m) invalid.push({ user: m[1]!, ip: m[2]! });
  }

  const alerts: SecurityAlert[] = [];

  // Acceso correcto desde una IP nunca vista. La lista de conocidas se guarda
  // para que el aviso salga una sola vez por IP.
  const knownFile = path.join(dir, 'known_ips.json');
  const known = await loadKnownIps(knownFile);
  const newIps = [...new Set(accepted.map((a) => a.ip))].filter((ip) => !known.has(ip));
  for (const ip of newIps.sort()) {
    const who = accepted.find((a) => a.ip === ip);
    alerts.push({ severity: 'warning', type: 'new_login_ip', ip, detail: who?.user ?? '?' });
    await logPanelEvent(`ALERTA acceso SSH desde IP nueva ip=${ip} usuario=${who?.user ?? '?'}`);
  }
  if (newIps.length) {
    await writeFile(knownFile, JSON.stringify([...known, ...newIps].sort())).catch(() => {});
  }

  for (const [ip, count] of failedByIp) {
    if (count >= BRUTE_FORCE_THRESHOLD) {
      alerts.push({ severity: 'critical', type: 'brute_force', ip, detail: '', count });
    }
  }

  if (invalid.length) {
    const probed = [...new Set(invalid.map((u) => u.user))].sort().slice(0, 8).join(', ');
    alerts.push({
      severity: 'warning',
      type: 'invalid_user_probe',
      ip: invalid[invalid.length - 1]!.ip,
      detail: probed,
      count: invalid.length,
    });
  }

  const failedAttempts = [...failedByIp.values()].reduce((a, b) => a + b, 0);
  return {
    available: true,
    updatedAt: info ? info.mtime.toISOString() : null,
    alerts,
    summary: {
      failedAttempts,
      distinctAttackerIps: failedByIp.size,
      successfulLogins: accepted.length,
      topFailedIps: countTop(failedByIp, 5),
      topFailedUsers: countTop(failedUsers, 5),
    },
    recentAccepted: accepted.slice(-10).reverse(),
    events,
  };
}

// --------------------------------------------------------------------------- //
// Utilidades para las rutas
// --------------------------------------------------------------------------- //

/**
 * Rechaza peticiones que el navegador marca como de otro sitio. Las rutas que
 * escriben en disco no pueden depender sólo de la cookie de sesión.
 */
export function isSameOriginRequest(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin';
}

/** IP real del cliente detrás de Cloudflare/Caddy, para el registro. */
export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '?'
  );
}
