/**
 * Categorías de aviso push, compartidas entre servidor y cliente.
 *
 * Vive aparte de `push.ts` porque ese módulo es `server-only` (arrastra la base
 * de datos y las claves VAPID) y los interruptores de Ajustes son un componente
 * de cliente.
 */

export const PUSH_CATEGORIES = [
  'cameras',
  'lights',
  'heating',
  'ac',
  'vacuum',
  'litter',
  'printer',
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Qué categorías tiene activas un usuario. */
export type PushCategoryPrefs = Record<PushCategory, boolean>;

export function isPushCategory(value: unknown): value is PushCategory {
  return typeof value === 'string' && (PUSH_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Valor del interruptor de avisos de un aparato cuando nadie lo ha tocado.
 * Las luces vienen apagadas: se encienden y apagan a todas horas y avisar de
 * cada una es ruido. El resto de aparatos avisa salvo que se diga lo contrario.
 */
export function devicePushDefault(category: PushCategory): boolean {
  return category !== 'lights';
}
