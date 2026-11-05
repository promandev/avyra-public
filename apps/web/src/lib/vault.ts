import 'server-only';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Supervisión de la bóveda de contraseñas (Vaultwarden).
 *
 * Avyra NO toca las contraseñas: el cifrado es de extremo a extremo con la
 * contraseña maestra y ni siquiera el servidor de Vaultwarden puede leerlas.
 * Esto sólo pregunta si el servicio está vivo y mira la carpeta de copias que
 * escribe el contenedor `vault-backup` (montada en sólo lectura).
 */

const PROBE_TIMEOUT_MS = 4000;
/** Una copia diaria que lleva más de esto sin renovarse es que algo ha fallado. */
const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;
const BACKUP_NAME = /^vaultwarden-\d{8}-\d{6}\.tar\.gz$/;

function envUrl(name: string): string | null {
  const url = process.env[name]?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

/** URL que abre el usuario (vía túnel de Cloudflare). */
export function getVaultPublicUrl(): string | null {
  return envUrl('VAULT_PUBLIC_URL');
}

export function isVaultConfigured(): boolean {
  return envUrl('VAULTWARDEN_URL') !== null && getVaultPublicUrl() !== null;
}

export interface VaultServiceStatus {
  online: boolean;
  version: string | null;
}

async function probe(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** `/alive` y `/api/version` son públicos en Vaultwarden: no hace falta sesión. */
export async function getVaultServiceStatus(): Promise<VaultServiceStatus> {
  const base = envUrl('VAULTWARDEN_URL');
  if (!base) return { online: false, version: null };

  const [alive, version] = await Promise.allSettled([
    probe(`${base}/alive`),
    probe(`${base}/api/version`),
  ]);
  return {
    online: alive.status === 'fulfilled',
    version: version.status === 'fulfilled' && typeof version.value === 'string' ? version.value : null,
  };
}

export interface VaultBackup {
  name: string;
  createdAt: Date;
  sizeBytes: number;
}

export interface VaultBackupSummary {
  /** La carpeta no está montada: la app se desplegó sin el volumen. */
  available: boolean;
  latest: VaultBackup | null;
  count: number;
  totalBytes: number;
  stale: boolean;
  /** Motivo del último fallo, si el contenedor de copias lo ha dejado escrito. */
  lastError: string | null;
}

export async function getVaultBackupSummary(): Promise<VaultBackupSummary> {
  const dir = process.env.VAULT_BACKUP_DIR?.trim();
  const empty: VaultBackupSummary = {
    available: false,
    latest: null,
    count: 0,
    totalBytes: 0,
    stale: false,
    lastError: null,
  };
  if (!dir) return empty;

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return empty;
  }

  const backups: VaultBackup[] = [];
  for (const name of names) {
    if (!BACKUP_NAME.test(name)) continue;
    try {
      const info = await stat(path.join(dir, name));
      backups.push({ name, createdAt: info.mtime, sizeBytes: info.size });
    } catch {
      // Borrada por la rotación entre readdir y stat.
    }
  }
  backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const lastError = await readFile(path.join(dir, 'last-error.txt'), 'utf8')
    .then((text) => text.trim() || null)
    .catch(() => null);

  const latest = backups[0] ?? null;
  return {
    available: true,
    latest,
    count: backups.length,
    totalBytes: backups.reduce((sum, b) => sum + b.sizeBytes, 0),
    stale: latest !== null && Date.now() - latest.createdAt.getTime() > BACKUP_STALE_MS,
    lastError,
  };
}
