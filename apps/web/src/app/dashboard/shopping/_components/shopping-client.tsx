'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  SHOPPING_ITEM_MAX_LENGTH,
  type ShoppingItem,
  type ShoppingList,
  type ShoppingPanel,
} from '@/lib/shopping-types';

/** Lo que se dice a Alexa llega a HA por push; basta con mirar cada poco. */
const POLL_MS = 15_000;
const NOTICE_MS = 6_000;

type Notice = { kind: 'ok' | 'error'; text: string };

const KNOWN_ERRORS = [
  'forbidden',
  'ha_not_configured',
  'ha_unavailable',
  'list_not_found',
  'invalid_request',
  'save_failed',
] as const;

function errorText(
  t: ReturnType<typeof useTranslations<'shopping'>>,
  code: string | undefined,
  status: number,
): string {
  if (code && (KNOWN_ERRORS as readonly string[]).includes(code)) {
    return t(`errors.${code as (typeof KNOWN_ERRORS)[number]}`);
  }
  return code ?? `HTTP ${status}`;
}

const isTemp = (uid: string) => uid.startsWith('tmp-');

/** Conserva lo último que se vio y añade el error. */
function withError(prev: ShoppingPanel | null, error: string): ShoppingPanel {
  return {
    lists: prev?.lists ?? [],
    listId: prev?.listId ?? null,
    items: prev?.items ?? [],
    canManage: prev?.canManage ?? false,
    error,
  };
}

function move<T>(xs: T[], from: number, to: number): T[] {
  if (from < 0 || from >= xs.length) return xs;
  const out = [...xs];
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
}

// ---------- Orden de las listas (propietario / admin) -------------------------

function ListOrderEditor({
  lists,
  onCancel,
  onSave,
}: {
  lists: ShoppingList[];
  onCancel: () => void;
  onSave: (order: string[]) => Promise<void>;
}) {
  const t = useTranslations('shopping');
  const [order, setOrder] = useState(lists);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rows = useRef(new Map<string, HTMLLIElement>());

  // Arrastre con pointer events: igual con ratón que con el dedo. El destino
  // es cuántas de las otras filas quedan por encima del puntero.
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragId) return;
    const from = order.findIndex((l) => l.id === dragId);
    let to = 0;
    for (const l of order) {
      if (l.id === dragId) continue;
      const r = rows.current.get(l.id)?.getBoundingClientRect();
      if (r && e.clientY > r.top + r.height / 2) to += 1;
    }
    if (to !== from) setOrder((o) => move(o, from, to));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(order.map((l) => l.id));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass animate-fade-in rounded-2xl p-5">
      <p className="font-medium">{t('reorderTitle')}</p>
      <p className="text-muted-foreground mt-1 text-sm">{t('reorderHint')}</p>

      <ol className="mt-4 space-y-2">
        {order.map((l, i) => (
          <li
            key={l.id}
            ref={(el) => {
              if (el) rows.current.set(l.id, el);
              else rows.current.delete(l.id);
            }}
            className={[
              'bg-background/60 flex items-center gap-2 rounded-xl border p-2 transition-shadow',
              dragId === l.id ? 'border-primary shadow-primary/10 shadow-lg' : 'border-border/60',
            ].join(' ')}
          >
            <button
              type="button"
              aria-label={t('dragHandle')}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragId(l.id);
              }}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDragId(null)}
              onPointerCancel={() => setDragId(null)}
              className="text-muted-foreground hover:bg-accent cursor-grab touch-none rounded-md p-1.5 active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
            <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
            {i === 0 && (
              <span className="bg-primary/15 text-primary shrink-0 rounded-full px-2 py-0.5 text-[11px]">
                {t('opensFirst')}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOrder((o) => move(o, i, i - 1))}
              disabled={i === 0}
              aria-label={t('moveUp')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md p-1.5 transition disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setOrder((o) => move(o, i, i + 1))}
              disabled={i === order.length - 1}
              aria-label={t('moveDown')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md p-1.5 transition disabled:opacity-30"
            >
              <ArrowDown className="size-4" />
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-xl px-4 py-2 text-sm transition"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="bg-primary text-primary-foreground shadow-primary/20 flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-lg transition hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('save')}
        </button>
      </div>
    </section>
  );
}

// ---------- Elemento ----------------------------------------------------------

function ItemRow({
  item,
  list,
  onToggle,
  onRename,
  onRemove,
}: {
  item: ShoppingItem;
  list: ShoppingList;
  onToggle: () => void;
  onRename: (summary: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('shopping');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.summary);
  const done = item.status === 'completed';
  const pending = isTemp(item.uid);

  const commit = () => {
    setEditing(false);
    const value = draft.trim();
    if (value && value !== item.summary) onRename(value);
    else setDraft(item.summary);
  };

  return (
    <li className="group flex items-center gap-3 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={!list.canUpdate || pending}
        aria-pressed={done}
        aria-label={done ? t('markPending') : t('markDone')}
        className={[
          'flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition disabled:cursor-not-allowed disabled:opacity-50',
          done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border hover:border-primary',
        ].join(' ')}
      >
        {done && <Check className="size-3.5" strokeWidth={3} />}
      </button>

      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={SHOPPING_ITEM_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(item.summary);
              setEditing(false);
            }
          }}
          aria-label={t('rename')}
          className="border-primary bg-background min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(item.summary);
            setEditing(true);
          }}
          disabled={!list.canUpdate || pending}
          title={list.canUpdate ? t('rename') : undefined}
          className={[
            'min-w-0 flex-1 truncate text-left text-sm disabled:cursor-default',
            done ? 'text-muted-foreground line-through' : 'text-foreground',
          ].join(' ')}
        >
          {item.summary}
        </button>
      )}

      {pending ? (
        <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
      ) : (
        list.canDelete && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-md p-1.5 transition sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
            aria-label={t('remove')}
            title={t('remove')}
          >
            <X className="size-4" />
          </button>
        )
      )}
    </li>
  );
}

// ---------- Página ------------------------------------------------------------

export function ShoppingClient({ configured }: { configured: boolean }) {
  const t = useTranslations('shopping');
  const [panel, setPanel] = useState<ShoppingPanel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [reordering, setReordering] = useState(false);

  // Mientras haya escrituras en vuelo, el sondeo no pisa el estado optimista.
  const writes = useRef(0);
  const inflight = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const tempSeq = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!force && (inflight.current || writes.current > 0 || document.hidden)) return;
    inflight.current = true;
    try {
      const list = selectedRef.current;
      const res = await fetch(`/api/shopping${list ? `?list=${encodeURIComponent(list)}` : ''}`, {
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as ShoppingPanel & { error?: string };
      // Una respuesta de la lista anterior no pisa la recién elegida.
      if ((writes.current > 0 && !force) || list !== selectedRef.current) return;
      if (res.ok) {
        setPanel(data);
        setSelected(data.listId);
        selectedRef.current = data.listId;
      } else {
        setPanel((prev) => withError(prev, data.error ?? `HTTP ${res.status}`));
      }
    } catch {
      setPanel((prev) => withError(prev, 'ha_unavailable'));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    void load(true);
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [configured, load]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  if (!configured) {
    return <Hint title={t('errors.ha_not_configured')} body={t('notConfiguredHint')} />;
  }

  const list = panel?.lists.find((l) => l.id === panel.listId) ?? null;
  const items = panel?.items ?? [];
  const todo = items.filter((i) => i.status === 'needs_action');
  const done = items.filter((i) => i.status === 'completed');

  /** Aplica el cambio en pantalla, lo manda y recarga la verdad de Alexa. */
  const write = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    body: Record<string, unknown>,
    optimistic: (items: ShoppingItem[]) => ShoppingItem[],
  ) => {
    if (!list) return;
    writes.current += 1;
    setPanel((p) => (p ? { ...p, items: optimistic(p.items) } : p));
    try {
      const res = await fetch('/api/shopping/items', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list: list.id, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(errorText(t, data.error, res.status));
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      writes.current -= 1;
      if (writes.current === 0) await load(true);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const summary = draft.trim();
    if (!summary) return;
    setDraft('');
    tempSeq.current += 1;
    const temp: ShoppingItem = { uid: `tmp-${tempSeq.current}`, summary, status: 'needs_action' };
    void write('POST', { summary }, (xs) => [...xs, temp]);
  };

  const toggle = (item: ShoppingItem) => {
    const completed = item.status !== 'completed';
    const status = completed ? 'completed' : 'needs_action';
    void write('PATCH', { uid: item.uid, completed }, (xs) =>
      xs.map((x) => (x.uid === item.uid ? { ...x, status } : x)),
    );
  };

  const rename = (item: ShoppingItem, summary: string) =>
    void write('PATCH', { uid: item.uid, summary }, (xs) =>
      xs.map((x) => (x.uid === item.uid ? { ...x, summary } : x)),
    );

  const remove = (uids: string[]) =>
    void write('DELETE', { uids }, (xs) => xs.filter((x) => !uids.includes(x.uid)));

  const saveOrder = async (order: string[]) => {
    try {
      const res = await fetch('/api/shopping/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(errorText(t, data.error, res.status));
      setReordering(false);
      setNotice({ kind: 'ok', text: t('orderSaved') });
      await load(true);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const switchList = (id: string) => {
    if (id === selected) return;
    setSelected(id);
    selectedRef.current = id;
    setPanel((p) => (p ? { ...p, listId: id, items: [] } : p));
    setLoading(true);
    void load(true);
  };

  if (panel && !panel.error && panel.lists.length === 0) {
    return <Hint title={t('noLists')} body={t('noListsHint')} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {notice && (
        <div
          role="status"
          className={[
            'animate-fade-in flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
            notice.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-destructive/30 bg-destructive/10 text-destructive',
          ].join(' ')}
        >
          {notice.kind === 'ok' ? (
            <Check className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="min-w-0 break-words">{notice.text}</span>
        </div>
      )}

      {panel?.error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{errorText(t, panel.error, 0)}</span>
          <button
            type="button"
            onClick={() => void load(true)}
            className="hover:bg-destructive/10 rounded-md p-1 transition"
            aria-label={t('retry')}
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      )}

      {reordering && panel && (
        <ListOrderEditor
          lists={panel.lists}
          onCancel={() => setReordering(false)}
          onSave={saveOrder}
        />
      )}

      {!reordering && (panel?.lists.length ?? 0) > 1 && (
        <div className="flex items-center gap-2">
          <div
            className="bg-muted/50 flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl p-1"
            role="tablist"
          >
            {panel!.lists.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={l.id === panel!.listId}
                onClick={() => switchList(l.id)}
                className={[
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition',
                  l.id === panel!.listId
                    ? 'bg-background text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {l.name}
                {l.pending > 0 && (
                  <span className="bg-primary/15 text-primary rounded-full px-1.5 text-[11px] tabular-nums">
                    {l.pending}
                  </span>
                )}
              </button>
            ))}
          </div>
          {panel!.canManage && (
            <button
              type="button"
              onClick={() => setReordering(true)}
              aria-label={t('reorder')}
              title={t('reorder')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground shrink-0 rounded-xl p-2.5 transition"
            >
              <ArrowUpDown className="size-4" />
            </button>
          )}
        </div>
      )}

      <section className="glass rounded-2xl p-5">
        {list?.canCreate !== false && (
          <form onSubmit={add} className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={SHOPPING_ITEM_MAX_LENGTH}
              placeholder={t('addPlaceholder')}
              aria-label={t('addPlaceholder')}
              disabled={!list}
              className="border-border bg-background focus:border-primary min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none transition disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!list || !draft.trim()}
              className="bg-primary text-primary-foreground shadow-primary/20 flex items-center gap-1.5 rounded-xl px-4 text-sm font-semibold shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t('add')}</span>
            </button>
          </form>
        )}

        {loading && items.length === 0 ? (
          <p className="text-muted-foreground mt-5 flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> {t('loading')}
          </p>
        ) : todo.length === 0 ? (
          <div className="text-muted-foreground mt-6 flex flex-col items-center gap-2 py-6 text-center">
            <ShoppingCart className="size-8 opacity-40" />
            <p className="text-sm">{t('empty')}</p>
            <p className="text-xs">{t('emptyHint')}</p>
          </div>
        ) : (
          list && (
            <ul className="divide-border/60 mt-3 divide-y">
              {todo.map((item) => (
                <ItemRow
                  key={item.uid}
                  item={item}
                  list={list}
                  onToggle={() => toggle(item)}
                  onRename={(s) => rename(item, s)}
                  onRemove={() => remove([item.uid])}
                />
              ))}
            </ul>
          )
        )}
      </section>

      {list && done.length > 0 && (
        <section className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs uppercase tracking-wide transition"
            >
              <ChevronDown className={`size-4 transition ${showDone ? '' : '-rotate-90'}`} />
              {t('completed', { count: done.length })}
            </button>
            {list.canDelete && (
              <button
                type="button"
                onClick={() => remove(done.map((i) => i.uid))}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition"
              >
                <Trash2 className="size-3.5" /> {t('clearCompleted')}
              </button>
            )}
          </div>
          {showDone && (
            <ul className="divide-border/60 mt-2 divide-y">
              {done.map((item) => (
                <ItemRow
                  key={item.uid}
                  item={item}
                  list={list}
                  onToggle={() => toggle(item)}
                  onRename={(s) => rename(item, s)}
                  onRemove={() => remove([item.uid])}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {list && !list.canCreate && !list.canUpdate && !list.canDelete && (
        <p className="text-muted-foreground text-center text-xs">{t('readOnly')}</p>
      )}
    </div>
  );
}

function Hint({ title, body }: { title: string; body: string }) {
  return (
    <div className="glass mx-auto max-w-2xl rounded-2xl p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-muted-foreground mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground mt-1 whitespace-pre-line text-sm">{body}</p>
        </div>
      </div>
    </div>
  );
}
