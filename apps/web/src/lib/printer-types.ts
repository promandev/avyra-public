/** Tipos y límites de la impresora compartidos entre servidor y cliente. */

/** Tope de subida. Un PDF escaneado de varias páginas cabe de sobra. */
export const PRINT_MAX_BYTES = 25 * 1024 * 1024;
export const PRINT_MAX_COPIES = 20;

/** Lo que acepta el selector de archivos. El servidor lo vuelve a comprobar por contenido. */
export const PRINT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.txt,application/pdf,image/jpeg,image/png,text/plain';

export type PrintColorMode = 'color' | 'monochrome';

export interface PrinterInk {
  name: string;
  /** 0-100, o `null` si la impresora no lo sabe (cartucho no original, etc.). */
  level: number | null;
  low: boolean;
  colors: string[];
  type: string | null;
}

export interface PrinterStatus {
  /** La impresora contesta directamente en la red. */
  online: boolean;
  /** El CUPS interno tiene la cola creada. */
  queueReady: boolean;
  state: 'idle' | 'processing' | 'stopped' | 'offline';
  reasons: string[];
  model: string | null;
  message: string | null;
  queueMessage: string | null;
  acceptingJobs: boolean;
  queuedJobs: number;
  inks: PrinterInk[];
}

export type PrintJobState =
  | 'pending'
  | 'held'
  | 'processing'
  | 'stopped'
  | 'canceled'
  | 'aborted'
  | 'completed';

export interface PrintJob {
  id: number;
  name: string;
  state: PrintJobState;
  reasons: string[];
  message: string | null;
  user: string | null;
  sheets: number | null;
  createdAt: string | null;
  completedAt: string | null;
}

export const ACTIVE_JOB_STATES: readonly PrintJobState[] = ['pending', 'held', 'processing', 'stopped'];

export interface PrinterPanel {
  status: PrinterStatus | null;
  jobs: PrintJob[];
  error?: string;
}
