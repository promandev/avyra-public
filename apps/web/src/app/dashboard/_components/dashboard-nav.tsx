'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Camera,
  Cat,
  ChevronDown,
  House,
  Flame,
  Lightbulb,
  LogOut,
  Menu,
  Printer,
  Server,
  Settings,
  ShoppingCart,
  Snowflake,
  Tv,
  Users,
  Vault,
  Wallet,
  X,
} from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';

import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { HouseholdSwitcher } from './household-switcher';
import { AvyraLogo } from '@/components/avyra-logo';
import { VacuumIcon } from '@/components/vacuum-icon';
import { EMPTY_PULSE, type HomePulse } from '@/lib/home-pulse-types';

/** Subsistemas que pueden mostrar un punto de "hay algo encendido". */
type PulseKey = 'lights' | 'heating' | 'cooling';

type NavItem = {
  href: Route | string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
  /** Enlaza el punto vivo del menú con el subsistema correspondiente. */
  pulseKey?: PulseKey;
  /** Sólo visible para el super admin de la plataforma. */
  superAdminOnly?: boolean;
};

/** Sección plegable: agrupa enlaces relacionados para que el menú escale. */
type NavGroup = {
  id: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
};

type NavEntry = NavItem | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry;

/** Todo lo que es domótica (aparatos controlables) vive en un mismo acordeón. */
const domoticsGroup: NavGroup = {
  id: 'domotics',
  labelKey: 'domotics',
  icon: House,
  items: [
    { href: '/dashboard/cameras', labelKey: 'cameras', icon: Camera, enabled: true },
    { href: '/dashboard/lights', labelKey: 'lights', icon: Lightbulb, enabled: true, pulseKey: 'lights' },
    { href: '/dashboard/heating', labelKey: 'heating', icon: Flame, enabled: true, pulseKey: 'heating' },
    { href: '/dashboard/ac', labelKey: 'ac', icon: Snowflake, enabled: true, pulseKey: 'cooling' },
    { href: '/dashboard/vacuum', labelKey: 'vacuum', icon: VacuumIcon, enabled: true },
    { href: '/dashboard/litter', labelKey: 'litter', icon: Cat, enabled: true },
  ],
};

/** Menú principal. Las secciones nuevas del hogar se añaden aquí, sueltas o en un grupo. */
const primaryNav: NavEntry[] = [
  domoticsGroup,
  { href: '/dashboard/printer', labelKey: 'printer', icon: Printer, enabled: true },
  { href: '/dashboard/shopping', labelKey: 'shopping', icon: ShoppingCart, enabled: true },
  {
    href: '/dashboard/finance',
    labelKey: 'finance',
    icon: Wallet,
    enabled: true,
    superAdminOnly: true,
  },
  {
    href: '/dashboard/streaming',
    labelKey: 'streaming',
    icon: Tv,
    enabled: true,
    superAdminOnly: true,
  },
  {
    href: '/dashboard/system',
    labelKey: 'system',
    icon: Server,
    enabled: true,
    superAdminOnly: true,
  },
  {
    href: '/dashboard/vault',
    labelKey: 'vault',
    icon: Vault,
    enabled: true,
    superAdminOnly: true,
  },
];

/**
 * Administración del hogar. Va abajo, junto al idioma y la sesión: no es a lo
 * que se entra a diario y compite con los dispositivos por la mirada.
 */
const secondaryNav: NavEntry[] = [
  { href: '/dashboard/members', labelKey: 'members', icon: Users, enabled: true },
  { href: '/dashboard/settings', labelKey: 'settings', icon: Settings, enabled: true },
];

/* Clases completas por subsistema: Tailwind necesita verlas literales. */
const DOT_TONE: Record<PulseKey, string> = {
  lights: 'bg-state-light text-state-light/40',
  heating: 'bg-state-heat text-state-heat/40',
  cooling: 'bg-state-cool text-state-cool/40',
};

type Household = { id: string; name: string; role: string };

interface DashboardNavProps {
  email: string;
  logoutAction: () => Promise<void>;
  households: Household[];
  activeHouseholdId: string;
  switchHouseholdAction: (id: string) => Promise<void>;
  version: string;
  isSuperAdmin: boolean;
  pulse?: HomePulse;
}

function NavLinks({
  items,
  onClose,
  isSuperAdmin,
  pulse,
  stagger = true,
  compact = false,
}: {
  items: NavEntry[];
  onClose?: () => void;
  isSuperAdmin: boolean;
  pulse: HomePulse;
  stagger?: boolean;
  /** Variante reducida para el bloque de administración del pie. */
  compact?: boolean;
}) {
  // Ocultar el enlace es sólo cosmético: la ruta y su API comprueban el rol
  // por su cuenta en el servidor.
  const isVisible = (item: NavItem) => !item.superAdminOnly || isSuperAdmin;

  return (
    <nav className={`space-y-1 ${stagger ? 'stagger-nav' : ''}`}>
      {items.map((entry) => {
        if (isGroup(entry)) {
          const visible = entry.items.filter(isVisible);
          if (visible.length === 0) return null;
          return (
            <NavGroupSection
              key={entry.id}
              group={entry}
              items={visible}
              onClose={onClose}
              pulse={pulse}
              compact={compact}
            />
          );
        }
        if (!isVisible(entry)) return null;
        return <NavLink key={entry.href} item={entry} onClose={onClose} pulse={pulse} compact={compact} />;
      })}
    </nav>
  );
}

const isActivePath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

function NavGroupSection({
  group,
  items,
  onClose,
  pulse,
  compact,
}: {
  group: NavGroup;
  items: NavItem[];
  onClose?: () => void;
  pulse: HomePulse;
  compact: boolean;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const hasActive = items.some((item) => isActivePath(pathname, item.href as string));
  const [open, setOpen] = useState(hasActive);

  // Al llegar a una página del grupo (enlace directo, portada...) se despliega.
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  const live = items.some((item) => item.pulseKey && pulse[item.pulseKey].active > 0);
  const panelId = `nav-group-${group.id}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={[
          'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300',
          hasActive && !open ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        ].join(' ')}
      >
        <group.icon className={`size-4 shrink-0 ${hasActive ? 'text-primary' : ''}`} />
        <span className="truncate">{t(group.labelKey as Parameters<typeof t>[0])}</span>
        <span className="ml-auto flex items-center gap-2">
          {/* Cerrado, el punto vivo sube al encabezado para no perder el aviso. */}
          {!open && live && (
            <span className="size-1.5 shrink-0 animate-pulse-ring rounded-full bg-primary text-primary/40" />
          )}
          <ChevronDown
            className={`size-4 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!open}
      >
        <div className="overflow-hidden">
          <div className="ml-5 space-y-1 border-l border-border/50 pl-2 pt-1">
            {items.map((item) => (
              <NavLink key={item.href} item={item} onClose={onClose} pulse={pulse} compact={compact} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLink({
  item,
  onClose,
  pulse,
  compact,
}: {
  item: NavItem;
  onClose?: () => void;
  pulse: HomePulse;
  compact: boolean;
}) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const pad = compact ? 'px-3 py-2' : 'px-3 py-2.5';
  const label = t(item.labelKey as Parameters<typeof t>[0]);

  if (!item.enabled) {
    return (
      <div
        className={`pointer-events-none flex items-center gap-3 rounded-xl text-sm text-muted-foreground/60 ${pad}`}
      >
        <item.icon className="size-4 shrink-0" />
        <span>{label}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
          {tc('soon')}
        </span>
      </div>
    );
  }

  const active = isActivePath(pathname, item.href as string);
  const liveCount = item.pulseKey ? pulse[item.pulseKey].active : 0;

  return (
    <Link
      href={item.href as Route}
      onClick={onClose}
      aria-current={active ? 'page' : undefined}
      className={[
        'group relative flex items-center gap-3 rounded-xl transition-all duration-300',
        compact ? 'text-[13px]' : 'text-sm',
        pad,
        active
          ? 'bg-primary/10 font-medium text-foreground shadow-[inset_0_1px_0_hsl(var(--primary)/0.25)]'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      ].join(' ')}
    >
      {/* Marcador de sección actual. */}
      <span
        className={[
          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-300',
          active ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      />

      <item.icon
        className={[
          'size-4 shrink-0 transition-colors duration-300',
          active ? 'text-primary' : 'group-hover:text-foreground',
        ].join(' ')}
      />
      <span className="truncate">{label}</span>

      {/* Punto vivo: este subsistema tiene algo encendido ahora mismo. */}
      {liveCount > 0 && (
        <span
          className={`ml-auto size-1.5 shrink-0 animate-pulse-ring rounded-full ${DOT_TONE[item.pulseKey!]}`}
          title={label}
        />
      )}
    </Link>
  );
}

function UserSection({ email, logoutAction }: { email: string; logoutAction: () => Promise<void> }) {
  const t = useTranslations('auth');

  return (
    <div className="border-t border-border/60 pt-4 text-sm">
      <p className="text-xs text-muted-foreground">{t('sessionAs')}</p>
      <p className="truncate text-foreground">{email}</p>
      <form action={logoutAction}>
        <button
          type="submit"
          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="size-3.5" /> {t('logout')}
        </button>
      </form>
    </div>
  );
}

export function DashboardNav({
  email,
  logoutAction,
  households,
  activeHouseholdId,
  switchHouseholdAction,
  version,
  isSuperAdmin,
  pulse = EMPTY_PULSE,
}: DashboardNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tn = useTranslations('nav');

  const switcher = (
    <HouseholdSwitcher
      households={households}
      activeHouseholdId={activeHouseholdId}
      switchAction={switchHouseholdAction}
    />
  );

  /** Pie común a la barra y al cajón: administración, idioma y sesión. */
  const footer = (onClose?: () => void) => (
    <div className="relative mt-auto space-y-4 pt-8">
      <NavLinks
        items={secondaryNav}
        onClose={onClose}
        isSuperAdmin={isSuperAdmin}
        pulse={pulse}
        stagger={false}
        compact
      />
      <LocaleSwitcher />
      <UserSection email={email} logoutAction={logoutAction} />
      <p className="select-none text-[10px] text-muted-foreground/50">v{version}</p>
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar ────────────────────────────────── */}
      {/* Altura fija de pantalla con scroll propio: el panel no debe arrastrar
          la barra hacia arriba cuando una sección es larga. */}
      <aside className="relative hidden h-dvh animate-slide-in-left flex-col overflow-y-auto border-r border-border/50 bg-card/40 p-6 backdrop-blur-xl styled-scrollbar md:flex">
        {/* Tenue lavado de marca en la parte alta de la barra. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-primary/[0.09] to-transparent"
          aria-hidden="true"
        />

        <div className="relative mb-5 flex items-center justify-between gap-2">
          <Link href="/dashboard" className="flex items-center transition-opacity hover:opacity-80">
            <AvyraLogo markSize={28} markClassName="text-foreground" wordmarkClassName="text-foreground text-[15px] font-medium" />
          </Link>
          <ThemeToggle />
        </div>

        <div className="relative mb-6">{switcher}</div>

        <div className="relative">
          <NavLinks items={primaryNav} isSuperAdmin={isSuperAdmin} pulse={pulse} />
        </div>

        {footer()}
      </aside>

      {/* ── Mobile top bar ─────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-40 flex animate-fade-in-down items-center justify-between border-b border-border/50 bg-card/70 px-4 py-3 backdrop-blur-xl md:hidden">
        <Link href="/dashboard" className="flex items-center transition-opacity hover:opacity-80">
          <AvyraLogo markSize={24} markClassName="text-foreground" wordmarkClassName="text-foreground text-[13px] font-medium" />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label={tn('openMenu')}
          >
            <Menu className="size-5" />
            {/* Aviso de que hay algo encendido, sin abrir el menú. */}
            {(pulse.lights.active > 0 || pulse.heating.active > 0 || pulse.cooling.active > 0) && (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
            )}
          </button>
        </div>
      </header>

      {/* ── Mobile drawer ──────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 animate-fade-in bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer panel */}
          <div className="fixed inset-y-0 left-0 z-50 flex w-72 animate-slide-in-left flex-col overflow-y-auto border-r border-border/50 bg-card p-6 shadow-2xl styled-scrollbar md:hidden">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-primary/[0.09] to-transparent"
              aria-hidden="true"
            />

            <div className="relative mb-8 flex items-center justify-between">
              <Link
                href="/dashboard"
                className="flex items-center transition-opacity hover:opacity-80"
                onClick={() => setDrawerOpen(false)}
              >
                <AvyraLogo markSize={28} markClassName="text-foreground" wordmarkClassName="text-foreground text-[15px] font-medium" />
              </Link>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label={tn('closeMenu')}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="relative mb-4">{switcher}</div>

            <div className="relative">
              <NavLinks
                items={primaryNav}
                onClose={() => setDrawerOpen(false)}
                isSuperAdmin={isSuperAdmin}
                pulse={pulse}
              />
            </div>

            {footer(() => setDrawerOpen(false))}
          </div>
        </>
      )}
    </>
  );
}
