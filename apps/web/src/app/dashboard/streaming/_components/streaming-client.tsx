'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  Gift,
  Loader2,
  Power,
  Radio,
  RefreshCw,
  Search,
  Timer,
  Tv,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import type { StreamingPanel } from '@/lib/streaming-control';
import { hasPendingDrops, isCampaignEligible, isCampaignMinable } from '@/lib/twitch-drops';
import type { MinerCampaign, MinerChannel, MinerDrop, MinerStatus } from '@/lib/twitch-miner';

const STATUS_POLL_MS = 5_000;
const PANEL_POLL_MS = 10_000;
const LISTS_POLL_MS = 20_000;
const NOTICE_MS = 6_000;
/** Drops pendientes que se enseñan por juego en el catálogo. */
const DROPS_PREVIEW = 3;

const TABS = ['progress', 'drops', 'channels', 'auto'] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab =>
  value !== null && (TABS as readonly string[]).includes(value);

type Notice = { kind: 'ok' | 'error'; text: string };

interface GameGroup {
  key: string;
  game: string;
  boxArt: string | null;
  linkUrl: string | null;
  minable: boolean;
  linked: boolean;
  mining: boolean;
  endsAt: string;
  pending: MinerDrop[];
}

interface CampaignEntry {
  campaign: MinerCampaign;
  mining: boolean;
  /** Tiene minutos acumulados o algún drop reclamado. */
  started: boolean;
}

/**
 * Llama a una ruta propia y lanza con el mejor motivo disponible: el proxy del
 * minero lo manda en `detail` y la ruta de control en `error`.
 */
async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: unknown; detail?: unknown };
  if (!res.ok) {
    const reason =
      typeof data.detail === 'string'
        ? data.detail
        : typeof data.error === 'string'
          ? data.error
          : `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return data as T;
}

/** Twitch devuelve fracciones de seis cifras que Safari no sabe leer. */
function parseIso(iso: string): Date | null {
  const date = new Date(iso.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Sondeo que no se solapa consigo mismo y descansa con la pestaña oculta. Antes
 * cada intervalo lanzaba su petición aunque la anterior siguiera colgada, y con
 * la Raspberry lenta se apilaban.
 */
function usePoll(load: () => Promise<void>, everyMs: number, enabled: boolean) {
  const inflight = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const tick = async () => {
      if (inflight.current || document.hidden) return;
      inflight.current = true;
      try {
        await load();
      } finally {
        inflight.current = false;
      }
    };
    void tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [load, everyMs, enabled]);
}

function Switch({
  checked,
  busy,
  disabled,
  label,
  icon,
  onToggle,
}: {
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  label: string;
  icon?: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy}
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center gap-2.5 rounded-full border border-border/60 py-1.5 pl-1.5 pr-3.5 transition hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-state-live' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`inline-flex size-5 items-center justify-center rounded-full bg-background shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : icon}
        </span>
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function BoxArt({ src, size }: { src: string | null; size: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-10 w-[30px]' : 'h-12 w-9';
  if (!src) return <div className={`${cls} shrink-0 rounded bg-muted`} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- carátula remota de Twitch
  return <img src={src} alt="" loading="lazy" className={`${cls} shrink-0 rounded object-cover`} />;
}

function DropBar({ drop, claimedLabel }: { drop: MinerDrop; claimedLabel: string }) {
  const ratio = drop.is_claimed ? 1 : Math.min(1, Math.max(0, drop.progress ?? 0));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate">{drop.name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {drop.is_claimed ? claimedLabel : `${drop.current_minutes}/${drop.required_minutes} min`}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label={drop.name}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            drop.is_claimed ? 'bg-state-live' : 'bg-foreground/70'
          }`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function StreamingClient({ configured }: { configured: boolean }) {
  const t = useTranslations('streaming');
  const format = useFormatter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [panel, setPanel] = useState<StreamingPanel | null>(null);
  const [channels, setChannels] = useState<MinerChannel[]>([]);
  const [campaigns, setCampaigns] = useState<MinerCampaign[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [channelDraft, setChannelDraft] = useState('');
  const [query, setQuery] = useState('');
  const [minableOnly, setMinableOnly] = useState(false);
  const [dropsChannelDraft, setDropsChannelDraft] = useState('');
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = searchParams.get('tab');
    return isTab(fromUrl) ? fromUrl : 'progress';
  });

  // Una respuesta vieja de un sondeo no debe pisar la que trae una orden recién
  // ejecutada, así que cada carga se numera y sólo aplica la última.
  const statusSeq = useRef(0);
  const panelSeq = useRef(0);
  const listsSeq = useRef(0);
  const busyRef = useRef(false);
  /** Mientras se escribe en el campo del canal, el sondeo no lo sobrescribe. */
  const draftTouched = useRef(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const loadStatus = useCallback(async () => {
    const seq = ++statusSeq.current;
    try {
      const data = await request<MinerStatus>('/api/streaming/status');
      if (seq !== statusSeq.current) return;
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      if (seq === statusSeq.current) setStatusError(err instanceof Error ? err.message : 'unknown');
    }
  }, []);

  const loadPanel = useCallback(async () => {
    const seq = ++panelSeq.current;
    try {
      const data = await request<StreamingPanel>('/api/streaming/control');
      if (seq !== panelSeq.current) return;
      setPanel(data);
      if (!draftTouched.current) setChannelDraft(data.targetChannel ?? '');
    } catch {
      // El bloque de estado ya avisa si algo no responde.
    }
  }, []);

  const loadLists = useCallback(async () => {
    const seq = ++listsSeq.current;
    try {
      const [ch, ca] = await Promise.all([
        request<{ channels?: MinerChannel[] }>('/api/streaming/channels'),
        request<{ campaigns?: MinerCampaign[] }>('/api/streaming/campaigns'),
      ]);
      if (seq !== listsSeq.current) return;
      setChannels(ch.channels ?? []);
      setCampaigns(ca.campaigns ?? []);
    } catch {
      // Ídem: el estado del minero ya lo cuenta.
    }
  }, []);

  usePoll(loadStatus, STATUS_POLL_MS, configured);
  usePoll(loadPanel, PANEL_POLL_MS, configured);
  usePoll(loadLists, LISTS_POLL_MS, configured);

  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const describe = useCallback(
    (err: unknown): string => {
      const message = err instanceof Error ? err.message : '';
      if (message === 'miner_unavailable' || message === 'miner_not_configured') {
        return t('minerUnreachable');
      }
      if (message === 'forbidden') return t('errorForbidden');
      return message || t('errorUnknown');
    },
    [t],
  );

  const minerGamesKey = (panel?.minerGames ?? []).map((g) => g.toLowerCase()).join('\n');

  /** Catálogo: una fila por juego con drops por reclamar. */
  const groups = useMemo(() => {
    const mining = new Set(minerGamesKey ? minerGamesKey.split('\n') : []);
    const byGame = new Map<string, MinerCampaign[]>();
    for (const c of campaigns) {
      if (!c.active || !hasPendingDrops(c)) continue;
      const key = c.game_name.toLowerCase();
      byGame.set(key, [...(byGame.get(key) ?? []), c]);
    }

    const out: GameGroup[] = [];
    for (const [key, list] of byGame) {
      const [first] = list;
      if (!first) continue;
      out.push({
        key,
        game: first.game_name,
        boxArt: list.find((c) => c.game_box_art_url)?.game_box_art_url ?? null,
        linkUrl: list.find((c) => !c.linked && c.link_url)?.link_url ?? null,
        minable: list.some(isCampaignMinable),
        // Si es minable sin estar vinculada, es por recompensas de Twitch.
        linked: list.some((c) => c.linked),
        mining: mining.has(key),
        endsAt: list.map((c) => c.ends_at).sort()[0] ?? first.ends_at,
        pending: list
          .flatMap((c) => c.drops.filter((d) => !d.is_claimed))
          .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0)),
      });
    }

    return out.sort(
      (a, b) =>
        Number(b.mining) - Number(a.mining) ||
        Number(b.minable) - Number(a.minable) ||
        a.game.localeCompare(b.game),
    );
  }, [campaigns, minerGamesKey]);

  /**
   * Progreso: cada campaña que la cuenta puede ganar, con TODOS sus drops,
   * reclamados incluidos. Es la vista de «cómo voy hoy», así que una campaña
   * completada no desaparece: se queda con sus barras llenas.
   */
  const progress = useMemo(() => {
    const mining = new Set(minerGamesKey ? minerGamesKey.split('\n') : []);
    const entries: CampaignEntry[] = campaigns
      .filter(isCampaignEligible)
      .map((campaign) => ({
        campaign: {
          ...campaign,
          drops: [...campaign.drops].sort((a, b) => a.required_minutes - b.required_minutes),
        },
        mining: mining.has(campaign.game_name.toLowerCase()),
        started: campaign.drops.some((d) => d.is_claimed || d.current_minutes > 0),
      }))
      .sort(
        (a, b) =>
          Number(b.mining) - Number(a.mining) ||
          Number(b.started) - Number(a.started) ||
          a.campaign.ends_at.localeCompare(b.campaign.ends_at),
      );
    return {
      active: entries.filter((e) => e.mining || e.started),
      idle: entries.filter((e) => !e.mining && !e.started),
    };
  }, [campaigns, minerGamesKey]);

  if (!configured) {
    return (
      <div className="glass rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{t('notConfigured')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('notConfiguredHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Ejecuta una orden: bloquea los demás mandos mientras dura, cuenta el
   * resultado en un aviso visible desde cualquier punto de la página y refresca
   * todo al acabar. Antes los fallos se tragaban y el botón parecía muerto.
   */
  const perform = async <T,>(key: string, fn: () => Promise<T>, success: (result: T) => string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setNotice(null);
    try {
      const result = await fn();
      setNotice({ kind: 'ok', text: success(result) });
    } catch (err) {
      setNotice({ kind: 'error', text: describe(err) });
    } finally {
      busyRef.current = false;
      setBusy(null);
      await Promise.all([loadStatus(), loadPanel(), loadLists()]);
    }
  };

  /** Orden a la ruta de control. Aplica al vuelo el panel que devuelve. */
  const control = async <T,>(command: Record<string, unknown>): Promise<T> => {
    const res = await request<{ result: T; panel: StreamingPanel }>(
      '/api/streaming/control',
      command,
    );
    setPanel(res.panel);
    return res.result;
  };

  /**
   * Cambia de pestaña y lo refleja en la URL sin navegar: un `router.replace`
   * volvería a pedir la página al servidor, y en la Raspberry eso se nota.
   */
  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'progress') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  };

  /** Flechas, Inicio y Fin mueven entre pestañas, como pide el patrón ARIA. */
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(tab);
    const target =
      e.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    const next = TABS[target];
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  };

  const oauth = status?.login.oauth_pending;
  const minerOk = panel?.minerOk ?? false;
  const mining = panel?.mining ?? false;
  const auto = panel?.autoEnabled ?? false;
  const viewerOn = panel?.viewerOn ?? false;
  const watching = channels.find((c) => c.watching);
  const locked = busy !== null;

  const stateLabel = (() => {
    if (statusError) return t('minerUnreachable');
    if (!status) return t('loading');
    const raw = status.status.trim();
    const watchingName = /Watching:?\s+(.+?)(?:\s+for\s+.+)?$/i.exec(raw)?.[1];
    if (watchingName) return t('stateWatching', { channel: watchingName });
    if (/^idle$/i.test(raw)) return t('stateIdle');
    if (/^initializing/i.test(raw)) return t('stateStarting');
    return raw;
  })();

  const needle = query.trim().toLowerCase();
  const visibleGroups = groups.filter(
    (g) => (!minableOnly || g.minable) && (!needle || g.key.includes(needle)),
  );

  const sortedChannels = [...channels].sort(
    (a, b) =>
      Number(b.watching) - Number(a.watching) ||
      Number(b.online) - Number(a.online) ||
      b.viewers - a.viewers,
  );

  const formatEnds = (iso: string) => {
    const date = parseIso(iso);
    return date
      ? format.dateTime(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : null;
  };

  const startGame = (game: string, key: string) =>
    perform(
      `game-${key}`,
      () => control<{ game: string; channel: string | null }>({ op: 'game', game }),
      (r) =>
        r.channel
          ? t('noticeGameStarted', { game: r.game, channel: r.channel })
          : t('noticeGameNoChannel', { game: r.game }),
    );

  const startChannelDrops = (login: string) =>
    perform(
      'channelDrops',
      () =>
        control<{ login: string; game: string; channel: string | null; pinned: boolean }>({
          op: 'channelDrops',
          login,
        }),
      (r) =>
        r.pinned
          ? t('noticeChannelDropsPinned', { channel: r.channel ?? r.login, game: r.game })
          : r.channel
            ? t('noticeChannelDropsOther', { login: r.login, game: r.game, channel: r.channel })
            : t('noticeGameNoChannel', { game: r.game }),
    );

  /** Acción de la derecha en una fila de juego: minando, minar o vincular. */
  const gameAction = (
    key: string,
    game: string,
    isMining: boolean,
    minable: boolean,
    linkUrl: string | null,
  ) => {
    if (isMining) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-state-live/40 bg-state-live/10 px-3 py-1.5 text-xs font-medium">
          <Radio className="size-3.5 text-state-live" />
          {t('dropsMining')}
        </span>
      );
    }
    if (minable) {
      const gameBusy = busy === `game-${key}`;
      return (
        <button
          type="button"
          onClick={() => startGame(game, key)}
          disabled={locked || !minerOk}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs transition hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {gameBusy && <Loader2 className="size-3.5 animate-spin" />}
          {gameBusy ? t('dropsStarting') : t('dropsMine')}
        </button>
      );
    }
    if (linkUrl) {
      return (
        <a
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs transition hover:bg-accent/60"
        >
          {t('dropsLink')}
          <ExternalLink className="size-3.5" />
        </a>
      );
    }
    return null;
  };

  const renderCampaign = ({ campaign, mining: isMining }: CampaignEntry) => {
    const ends = formatEnds(campaign.ends_at);
    const claimed = campaign.drops.filter((d) => d.is_claimed).length;
    return (
      <li key={campaign.id} className="py-4 first:pt-0 last:pb-0">
        <div className="flex items-start gap-3">
          <BoxArt src={campaign.game_box_art_url} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{campaign.game_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {campaign.name}
              {' · '}
              {t('progressClaimedCount', { claimed, total: campaign.drops.length })}
              {ends && ' · ' + t('dropsEnds', { date: ends })}
            </p>
          </div>
          <div className="shrink-0">
            {gameAction(
              campaign.game_name.toLowerCase(),
              campaign.game_name,
              isMining,
              isCampaignMinable(campaign),
              null,
            )}
          </div>
        </div>
        <ul className="mt-3 space-y-2.5">
          {campaign.drops.map((d) => (
            <li key={d.id}>
              <DropBar drop={d} claimedLabel={t('claimed')} />
            </li>
          ))}
        </ul>
      </li>
    );
  };

  const tabMeta: Record<Tab, { label: string; icon: ReactNode; badge: ReactNode }> = {
    progress: {
      label: t('tabProgress'),
      icon: <Activity className="size-4" />,
      badge: progress.active.length || null,
    },
    drops: {
      label: t('tabDrops'),
      icon: <Gift className="size-4" />,
      badge: groups.filter((g) => g.minable).length || null,
    },
    channels: {
      label: t('tabChannels'),
      icon: <Tv className="size-4" />,
      badge: channels.filter((c) => c.online).length || null,
    },
    auto: {
      label: t('tabAuto'),
      icon: <Timer className="size-4" />,
      badge:
        auto || viewerOn ? (
          <span className="size-1.5 rounded-full bg-state-live" aria-hidden="true" />
        ) : null,
    },
  };

  /**
   * Encender algo del seguimiento con un canal escrito y sin guardar lo guarda
   * antes: es lo que se espera al ver el nombre en el campo.
   */
  const ensureFollowed = async () => {
    const draft = channelDraft.trim();
    if (draft && draft.toLowerCase() !== (panel?.targetChannel ?? '')) {
      const followed = await control<{ login: string }>({ op: 'follow', login: draft });
      draftTouched.current = false;
      setChannelDraft(followed.login);
    } else if (!draft && !panel?.targetChannel) {
      throw new Error(t('autoNeedsChannel'));
    }
  };

  const toggleAutomation = () =>
    perform(
      'auto',
      async () => {
        const enabling = !auto;
        if (enabling) await ensureFollowed();
        await control({ op: 'auto', enabled: enabling });
        return enabling;
      },
      (enabled) => (enabled ? t('noticeAutoOn') : t('noticeAutoOff')),
    );

  const toggleViewer = () =>
    perform(
      'viewer',
      async () => {
        const enabling = !viewerOn;
        if (enabling) await ensureFollowed();
        await control({ op: 'viewer', on: enabling });
        return enabling;
      },
      (on) => (on ? t('noticeViewerOn') : t('noticeViewerOff')),
    );

  return (
    <div className="space-y-4">
      {/* Estado y sesión de Twitch: siempre a la vista, sea cual sea la pestaña */}
      <section className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('state')}</p>
            <p className="mt-0.5 flex items-center gap-2 text-lg font-medium">
              {watching && <Radio className="size-4 shrink-0 text-state-live" />}
              <span className="truncate">{stateLabel}</span>
            </p>
            {status && (
              <p className="text-sm text-muted-foreground">
                {status.login.user_id ? t('loginOk') : t('loginRequired')}
              </p>
            )}
            {viewerOn && panel?.targetChannel && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Eye className="size-3.5 shrink-0 text-state-live" />
                {t('viewerHeader', { channel: panel.targetChannel })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Pinta el estado real del minero, no una copia local. */}
            <Switch
              checked={mining}
              busy={busy === 'power'}
              disabled={locked || !minerOk}
              label={mining ? t('powerOn') : t('powerOff')}
              icon={
                <Power
                  className={`size-3 ${mining ? 'text-state-live' : 'text-muted-foreground'}`}
                />
              }
              onToggle={() =>
                perform(
                  'power',
                  () =>
                    control<{ on: boolean; game: string | null; channel: string | null }>({
                      op: 'power',
                      on: !mining,
                    }),
                  (r) =>
                    !r.on
                      ? t('noticePowerOff')
                      : r.channel
                        ? t('noticePowerOnChannel', { game: r.game ?? '', channel: r.channel })
                        : t('noticePowerOn'),
                )
              }
            />

            <button
              type="button"
              onClick={() =>
                perform(
                  'reload',
                  () => request('/api/streaming/reload', {}),
                  () => t('noticeReload'),
                )
              }
              disabled={locked || !minerOk}
              aria-label={t('refresh')}
              className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm transition hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'reload' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span className="hidden sm:inline">{t('refresh')}</span>
            </button>
          </div>
        </div>

        {oauth && (
          <div className="mt-4 rounded-md border border-state-light/40 bg-state-light/10 p-4">
            <p className="text-sm font-medium">{t('oauthTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('oauthHint')}</p>
            <p className="mt-3 font-mono text-2xl tracking-[0.3em]">{oauth.code}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={oauth.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-sm underline underline-offset-4"
              >
                {oauth.url} <ExternalLink className="size-3.5" />
              </a>
              <button
                type="button"
                onClick={() =>
                  perform(
                    'oauth',
                    () => request('/api/streaming/oauth/confirm', {}),
                    () => t('noticeOauth'),
                  )
                }
                disabled={locked}
                className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'oauth' ? t('confirming') : t('oauthDone')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Pestañas: pegadas arriba al hacer scroll, debajo de la barra móvil.
          En móvil cuatro pestañas en fila no caben con icono, texto y contador,
          así que el icono va encima de la etiqueta y el contador pasa a burbuja
          en la esquina. Desde `sm` vuelven a ir en línea. */}
      <div
        role="tablist"
        aria-label={t('tabsLabel')}
        onKeyDown={onTabKeyDown}
        className="glass sticky top-16 z-20 flex gap-1 rounded-2xl p-1 md:top-4"
      >
        {TABS.map((id) => {
          const selected = tab === id;
          const meta = tabMeta[id];
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              id={`streaming-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`streaming-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(id)}
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 pb-1.5 pt-2 text-[11px] leading-tight transition sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                selected
                  ? 'bg-primary/10 font-medium text-foreground shadow-[inset_0_1px_0_hsl(var(--primary)/0.25)]'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`}
            >
              {meta.icon}
              <span className="max-w-full truncate">{meta.label}</span>
              {meta.badge !== null && (
                <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground sm:static sm:h-auto sm:min-w-5 sm:px-1.5 sm:text-[11px]">
                  {meta.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`streaming-panel-${tab}`}
        aria-labelledby={`streaming-tab-${tab}`}
        tabIndex={0}
        className="glass rounded-2xl p-5 outline-none sm:p-6"
      >
        {/* ── Progreso ─────────────────────────────────────────────────────── */}
        {tab === 'progress' &&
          (progress.active.length === 0 && progress.idle.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('progressEmpty')}</p>
          ) : (
            <>
              {progress.active.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('progressNothingYet')}</p>
              ) : (
                <ul className="divide-y divide-border/60">{progress.active.map(renderCampaign)}</ul>
              )}

              {progress.idle.length > 0 && (
                <details className="group mt-5 border-t border-border/60 pt-4">
                  <summary className="cursor-pointer select-none text-sm text-muted-foreground transition hover:text-foreground">
                    {t('progressNotStarted', { count: progress.idle.length })}
                  </summary>
                  <ul className="mt-4 divide-y divide-border/60">
                    {progress.idle.map(renderCampaign)}
                  </ul>
                </details>
              )}
            </>
          ))}

        {/* ── Catálogo de drops ────────────────────────────────────────────── */}
        {tab === 'drops' && (
          <>
            <p className="mb-4 max-w-prose text-sm text-muted-foreground">{t('dropsHint')}</p>

            {/* Drops en el canal de una persona concreta */}
            <form
              className="mb-5 rounded-xl border border-border/60 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void startChannelDrops(dropsChannelDraft);
              }}
            >
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('dropsChannelLabel')}
                </span>
                <input
                  type="text"
                  value={dropsChannelDraft}
                  onChange={(e) => setDropsChannelDraft(e.target.value)}
                  placeholder={t('dropsChannelPlaceholder')}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={locked || !minerOk || dropsChannelDraft.trim().length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs transition hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === 'channelDrops' && <Loader2 className="size-3.5 animate-spin" />}
                  {t('dropsChannelSubmit')}
                </button>
                {panel?.targetChannel && (
                  <button
                    type="button"
                    onClick={() => void startChannelDrops(panel.targetChannel ?? '')}
                    disabled={locked || !minerOk}
                    className="text-xs text-muted-foreground underline underline-offset-4 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('dropsChannelUseFollowed', { channel: panel.targetChannel })}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t('dropsChannelHint')}</p>
            </form>

            <div className="mb-2 flex flex-wrap items-center gap-3">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t('dropsSearch')}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('dropsSearch')}
                  className="w-full rounded-md border border-border/60 bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-foreground/40"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={minableOnly}
                  onChange={(e) => setMinableOnly(e.target.checked)}
                  className="size-4"
                />
                {t('dropsMinableOnly')}
              </label>
            </div>

            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dropsNone')}</p>
            ) : visibleGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dropsEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {visibleGroups.map((g) => {
                  const ends = formatEnds(g.endsAt);
                  return (
                    <li key={g.key} className="flex items-start gap-3 py-3.5">
                      <BoxArt src={g.boxArt} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{g.game}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('dropsCount', { count: g.pending.length })}
                          {ends && ' · ' + t('dropsEnds', { date: ends })}
                        </p>
                        <p
                          className={`mt-0.5 text-xs ${g.minable ? 'text-state-live-fg' : 'text-muted-foreground'}`}
                        >
                          {!g.minable
                            ? t('dropsNeedsLink')
                            : g.linked
                              ? t('dropsLinked')
                              : t('dropsTwitchReward')}
                        </p>
                        {g.minable && g.pending.length > 0 && (
                          <ul className="mt-2 space-y-2">
                            {g.pending.slice(0, DROPS_PREVIEW).map((d) => (
                              <li key={d.id}>
                                <DropBar drop={d} claimedLabel={t('claimed')} />
                              </li>
                            ))}
                            {g.pending.length > DROPS_PREVIEW && (
                              <li className="text-xs text-muted-foreground">
                                {t('dropsMore', { count: g.pending.length - DROPS_PREVIEW })}
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                      <div className="shrink-0">
                        {gameAction(g.key, g.game, g.mining, g.minable, g.linkUrl)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* ── Canales del juego en curso ───────────────────────────────────── */}
        {tab === 'channels' && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{t('channelsHint')}</p>
              <button
                type="button"
                onClick={() =>
                  perform(
                    'exitManual',
                    () => control<{ alreadyAuto: boolean }>({ op: 'exitManual' }),
                    (r) => (r.alreadyAuto ? t('noticeAlreadyAuto') : t('noticeBackToAuto')),
                  )
                }
                disabled={locked || !minerOk}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'exitManual' && <Loader2 className="size-3 animate-spin" />}
                {t('backToAuto')}
              </button>
            </div>

            {sortedChannels.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noChannels')}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {sortedChannels.map((c) => {
                  const channelBusy = busy === `channel-${c.id}`;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          c.watching
                            ? 'bg-state-live'
                            : c.online
                              ? 'bg-muted-foreground/50'
                              : 'border border-border bg-transparent'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.game ?? t('noGame')}
                          {c.drops_enabled ? ' · ' + t('dropsOn') : ''}
                        </p>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {c.online ? t('viewers', { count: c.viewers }) : t('offline')}
                      </span>
                      {c.watching ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-state-live/40 bg-state-live/10 px-2.5 py-1 text-xs font-medium">
                          <Radio className="size-3 text-state-live" />
                          {t('watching')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            perform(
                              `channel-${c.id}`,
                              () => control<{ channel: string }>({ op: 'channel', channelId: c.id }),
                              (r) => t('noticeChannel', { channel: r.channel }),
                            )
                          }
                          disabled={locked || !c.online || !minerOk}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs transition hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {channelBusy && <Loader2 className="size-3 animate-spin" />}
                          {t('watchThis')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* ── Seguimiento automático ───────────────────────────────────────── */}
        {tab === 'auto' && (
          <>
            <p className="mb-4 max-w-prose text-sm text-muted-foreground">{t('followHint')}</p>

            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(
                  'follow',
                  async () => {
                    const r = await control<{ login: string; live: boolean }>({
                      op: 'follow',
                      login: channelDraft,
                    });
                    draftTouched.current = false;
                    setChannelDraft(r.login);
                    return r;
                  },
                  (r) =>
                    r.live
                      ? t('noticeFollow', { channel: r.login })
                      : `${t('noticeFollow', { channel: r.login })} ${t('noticeFollowOffline')}`,
                );
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('autoChannel')}
                </span>
                <input
                  type="text"
                  value={channelDraft}
                  onChange={(e) => {
                    draftTouched.current = true;
                    setChannelDraft(e.target.value);
                  }}
                  placeholder="oskar1up"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                />
              </label>
              <button
                type="submit"
                disabled={locked || channelDraft.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 text-sm transition hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'follow' && <Loader2 className="size-4 animate-spin" />}
                {t('autoSave')}
              </button>
            </form>

            {/* Viendo ahora: el visor propio, independiente de los drops */}
            <div className="mt-5 rounded-xl border border-border/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Eye className="size-4 shrink-0" />
                    {t('viewerTitle')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {panel?.viewerLastNote ?? t('viewerNoNote')}
                  </p>
                </div>
                <Switch
                  checked={viewerOn}
                  busy={busy === 'viewer'}
                  disabled={locked || !panel}
                  label={viewerOn ? t('viewerOn') : t('viewerOff')}
                  onToggle={toggleViewer}
                />
              </div>
            </div>

            {/* Automático: enciende y apaga «Viendo ahora» por tramos al azar */}
            <div className="mt-6 flex flex-wrap items-start justify-between gap-3 border-t border-border/60 pt-5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Timer className="size-4 shrink-0" />
                  {t('autoSectionTitle')}
                </p>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('autoHint')}</p>
                <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                  {t('autoManualNote')}
                </p>
              </div>
              <Switch
                checked={auto}
                busy={busy === 'auto'}
                disabled={locked || !panel}
                label={auto ? t('autoOn') : t('autoOff')}
                onToggle={toggleAutomation}
              />
            </div>

            {/* Tramos sorteados para ESTA emisión, para que se vea que no es fijo. */}
            {panel?.joinAfterMin != null && panel.leaveAfterMin != null && (
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border/60 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t('autoJoinAt')}</dt>
                  <dd className="mt-0.5 text-sm tabular-nums">
                    {t('autoMinuteMark', { minutes: panel.joinAfterMin })}
                    {panel.joinedAt && ' · ' + t('autoAlreadyJoined')}
                  </dd>
                </div>
                <div className="rounded-md border border-border/60 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t('autoLeaveAt')}</dt>
                  <dd className="mt-0.5 text-sm tabular-nums">
                    {t('autoMinuteMark', { minutes: panel.leaveAfterMin })}
                    {panel.finishedAt && ' · ' + t('autoAlreadyLeft')}
                  </dd>
                </div>
              </dl>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
              <p className="min-w-0 text-xs text-muted-foreground">
                {panel?.lastTickNote ?? t('autoNoTickYet')}
              </p>
              <button
                type="button"
                onClick={() =>
                  perform(
                    'tick',
                    () => control<{ note: string }>({ op: 'tick' }),
                    (r) => r.note,
                  )
                }
                disabled={locked || !panel}
                className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'tick' && <Loader2 className="size-3 animate-spin" />}
                {busy === 'tick' ? t('autoChecking') : t('autoCheckNow')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Aviso flotante: visible aunque el botón pulsado quede lejos. */}
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-xl border bg-background/95 p-3 text-sm shadow-lg backdrop-blur ${
            notice.kind === 'error' ? 'border-destructive/40' : 'border-state-live/40'
          }`}
        >
          {notice.kind === 'error' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <Check className="mt-0.5 size-4 shrink-0 text-state-live" />
          )}
          <p className="min-w-0 flex-1">{notice.text}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t('dismiss')}
            className="shrink-0 text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
