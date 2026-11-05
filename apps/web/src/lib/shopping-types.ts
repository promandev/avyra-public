/**
 * Tipos compartidos por la sección Lista de la compra (servidor y cliente).
 *
 * Las listas son las de Alexa, que Home Assistant expone como entidades `todo`
 * a través de la integración oficial "Alexa Devices" (HA 2026.7+).
 */

/** Bits de `supported_features` de una entidad `todo` de Home Assistant. */
export const TODO_FEATURE = {
  CREATE: 1,
  DELETE: 2,
  UPDATE: 4,
} as const;

export interface ShoppingList {
  /** `todo.xxx` */
  id: string;
  name: string;
  /** Elementos pendientes, según el estado de la entidad. */
  pending: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export type ShoppingItemStatus = 'needs_action' | 'completed';

export interface ShoppingItem {
  uid: string;
  summary: string;
  status: ShoppingItemStatus;
}

export interface ShoppingPanel {
  lists: ShoppingList[];
  /** Lista mostrada; `null` si no hay ninguna lista de Alexa en Home Assistant. */
  listId: string | null;
  items: ShoppingItem[];
  /** Propietario o admin del hogar: puede cambiar el orden de las listas. */
  canManage: boolean;
  error?: string;
}

export const SHOPPING_ITEM_MAX_LENGTH = 200;
