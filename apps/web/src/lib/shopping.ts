import 'server-only';

import { env } from './env';
import { TODO_FEATURE, type ShoppingItem, type ShoppingList } from './shopping-types';

/**
 * Listas de Alexa a través de Home Assistant.
 *
 * Amazon cerró en 2024 su API pública de listas, así que no hay forma oficial
 * de hablar con ellas directamente. La integración "Alexa Devices" de HA las
 * expone como entidades `todo` y recibe por push los cambios hechos por voz:
 * aquí sólo se usan los servicios estándar `todo.*` sobre esas entidades.
 *
 * Por debajo HA usa la API no oficial de la app de Alexa, así que cada llamada
 * acaba en la nube de Amazon: se le pone un tope para no colgar la petición.
 */

const HA_TIMEOUT_MS = 15_000;

export class ShoppingError extends Error {
  constructor(
    readonly code: 'ha_not_configured' | 'ha_unavailable' | 'list_not_found',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function isHaConfigured(): boolean {
  return !!env.HA_BASE_URL && !!env.HA_TOKEN;
}

async function ha(path: string, init?: RequestInit): Promise<Response> {
  if (!env.HA_BASE_URL || !env.HA_TOKEN) throw new ShoppingError('ha_not_configured');
  const base = env.HA_BASE_URL.replace(/\/$/, '');
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.HA_TOKEN}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(HA_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ShoppingError('ha_unavailable', err instanceof Error ? err.message : String(err));
  }
}

async function callTodoService(
  service: string,
  entityId: string,
  data: Record<string, unknown>,
  returnResponse = false,
): Promise<unknown> {
  const res = await ha(`/api/services/todo/${service}${returnResponse ? '?return_response' : ''}`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: entityId, ...data }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ShoppingError('ha_unavailable', `todo.${service}: ${res.status} ${detail}`.trim());
  }
  return res.json().catch(() => null);
}

interface AlexaTodoEntity {
  id: string;
  /** Nombre del dispositivo de HA al que cuelga la lista: la cuenta de Amazon. */
  device: string;
}

/**
 * Las entidades `todo` que crea la integración de Alexa.
 *
 * El registro de entidades sólo se ve por websocket; la API de plantillas sí
 * sabe a qué integración pertenece cada una, y así no se cuela la lista
 * interna de HA (`shopping_list`), que no está en Alexa.
 */
async function alexaTodoEntities(): Promise<AlexaTodoEntity[]> {
  const template = `{% set ns = namespace(out=[]) %}
{%- for id in integration_entities('alexa_devices') | select('match', 'todo[.]') -%}
  {%- set dev = device_id(id) -%}
  {%- set ns.out = ns.out + [{'id': id, 'device': (device_attr(dev, 'name_by_user') or device_attr(dev, 'name') or '') if dev else ''}] -%}
{%- endfor -%}
{{ ns.out | tojson }}`;
  const res = await ha('/api/template', { method: 'POST', body: JSON.stringify({ template }) });
  if (!res.ok) throw new ShoppingError('ha_unavailable', `template: ${res.status}`);
  const raw = JSON.parse(await res.text()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): AlexaTodoEntity[] => {
    const x = e as { id?: unknown; device?: unknown };
    return typeof x.id === 'string'
      ? [{ id: x.id, device: typeof x.device === 'string' ? x.device : '' }]
      : [];
  });
}

/**
 * HA llama a cada lista "<dispositivo> <lista>", y el dispositivo es la cuenta
 * de Amazon (un correo). Aquí sólo interesa el nombre de la lista.
 */
function listName(friendlyName: unknown, device: string, id: string): string {
  const name = typeof friendlyName === 'string' ? friendlyName.trim() : '';
  if (!name) return id;
  if (device && name.startsWith(`${device} `)) return name.slice(device.length + 1).trim() || name;
  return name;
}

/** Sin orden guardado, primero la lista de la compra: es a lo que se viene aquí. */
function rank(list: ShoppingList): number {
  return /shopping|compra|course/i.test(`${list.id} ${list.name}`) ? 0 : 1;
}

/**
 * Listas de Alexa en el orden elegido por el hogar (`order`). Las que no están
 * en ese orden (p. ej. una lista nueva creada en Alexa) van detrás, con la de
 * la compra delante y el resto por nombre.
 */
export async function getShoppingLists(order: string[] = []): Promise<ShoppingList[]> {
  const entities = await alexaTodoEntities();
  const lists = await Promise.all(
    entities.map(async ({ id, device }): Promise<ShoppingList | null> => {
      const res = await ha(`/api/states/${id}`);
      if (!res.ok) return null;
      const s = (await res.json()) as { state: string; attributes?: Record<string, unknown> };
      if (s.state === 'unavailable') return null;
      const features = Number(s.attributes?.supported_features ?? 0);
      const pending = Number(s.state);
      return {
        id,
        name: listName(s.attributes?.friendly_name, device, id),
        pending: Number.isFinite(pending) ? pending : 0,
        canCreate: (features & TODO_FEATURE.CREATE) !== 0,
        canUpdate: (features & TODO_FEATURE.UPDATE) !== 0,
        canDelete: (features & TODO_FEATURE.DELETE) !== 0,
      };
    }),
  );
  const position = (l: ShoppingList) => {
    const i = order.indexOf(l.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return lists
    .filter((l): l is ShoppingList => l !== null)
    .sort((a, b) => position(a) - position(b) || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Comprueba que `entityId` es una lista de Alexa antes de tocarla: el cliente
 * elige la lista, y sin esto podría escribir en cualquier entidad `todo` de HA.
 */
export async function assertAlexaList(entityId: string): Promise<void> {
  const entities = await alexaTodoEntities();
  if (!entities.some((e) => e.id === entityId)) throw new ShoppingError('list_not_found');
}

export async function getShoppingItems(entityId: string): Promise<ShoppingItem[]> {
  const data = (await callTodoService(
    'get_items',
    entityId,
    { status: ['needs_action', 'completed'] },
    true,
  )) as { service_response?: Record<string, { items?: unknown[] }> } | null;

  const raw = data?.service_response?.[entityId]?.items ?? [];
  return raw.flatMap((item): ShoppingItem[] => {
    const i = item as { uid?: unknown; summary?: unknown; status?: unknown };
    if (typeof i.uid !== 'string' || typeof i.summary !== 'string') return [];
    return [
      {
        uid: i.uid,
        summary: i.summary,
        status: i.status === 'completed' ? 'completed' : 'needs_action',
      },
    ];
  });
}

export async function addShoppingItem(entityId: string, summary: string): Promise<void> {
  await callTodoService('add_item', entityId, { item: summary });
}

export async function updateShoppingItem(
  entityId: string,
  uid: string,
  changes: { summary?: string; completed?: boolean },
): Promise<void> {
  const data: Record<string, unknown> = { item: uid };
  if (changes.summary !== undefined) data.rename = changes.summary;
  if (changes.completed !== undefined)
    data.status = changes.completed ? 'completed' : 'needs_action';
  await callTodoService('update_item', entityId, data);
}

export async function removeShoppingItems(entityId: string, uids: string[]): Promise<void> {
  await callTodoService('remove_item', entityId, { item: uids });
}
