/**
 * Tipos compartidos entre el servidor y el cliente de la sección Sistema.
 * Viven aparte porque `system-panel.ts` es `server-only`.
 */

export interface SystemMetrics {
  cpu: {
    /** Uso medio de todos los núcleos, 0-100. `null` si /proc no es legible. */
    percent: number | null;
    cores: number;
    load: [number, number, number] | null;
    temperatureC: number | null;
  };
  memory: { totalBytes: number; usedBytes: number; percent: number } | null;
  swap: { totalBytes: number; usedBytes: number; percent: number } | null;
  /** Sistema de ficheros de la tarjeta SD, medido sobre la carpeta montada. */
  disk: { totalBytes: number; usedBytes: number; freeBytes: number; percent: number } | null;
  uptimeSeconds: number | null;
  generatedAt: string;
}

export type SecurityAlertType = 'new_login_ip' | 'brute_force' | 'invalid_user_probe';

export interface SecurityAlert {
  severity: 'warning' | 'critical';
  type: SecurityAlertType;
  ip: string;
  /** Usuario implicado, o lista de usuarios sondeados. */
  detail: string;
  count?: number;
}

export interface SecurityReport {
  /** El exportador del journal (cron del host) ha escrito alguna vez. */
  available: boolean;
  /** Última escritura del exportador; si se para, el informe se queda viejo. */
  updatedAt: string | null;
  alerts: SecurityAlert[];
  summary: {
    failedAttempts: number;
    distinctAttackerIps: number;
    successfulLogins: number;
    topFailedIps: [string, number][];
    topFailedUsers: [string, number][];
  };
  recentAccepted: { at: string | null; method: string; user: string; ip: string }[];
  /** Últimas acciones hechas desde esta sección (subidas, borrados…). */
  events: string[];
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: string | null;
  mode: string;
}

export interface DirListing {
  path: string;
  parent: string | null;
  root: string;
  entries: FileEntry[];
}

export type FileContent =
  | { path: string; size: number; binary: true }
  | { path: string; size: number; binary: false; truncated: boolean; content: string };
