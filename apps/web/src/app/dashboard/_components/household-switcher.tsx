'use client';

import { useTransition, useRef, useEffect } from 'react';
import { ChevronDown, Check, Home, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Household = { id: string; name: string; role: string };

interface Props {
  households: Household[];
  activeHouseholdId: string;
  switchAction: (id: string) => Promise<void>;
}

export function HouseholdSwitcher({ households, activeHouseholdId, switchAction }: Props) {
  const t = useTranslations('settings');
  const [isPending, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const active = households.find((h) => h.id === activeHouseholdId) ?? households[0];

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  if (households.length === 1) {
    // Single household — just show the name, no dropdown
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10">
        <Home className="size-3.5 text-primary shrink-0" />
        <span className="text-sm font-medium truncate">{active?.name}</span>
      </div>
    );
  }

  return (
    <details ref={detailsRef} className="relative group">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 bg-primary/10 hover:bg-primary/20 transition select-none"
        aria-label={t('switchHousehold')}
      >
        {isPending ? (
          <Loader2 className="size-3.5 text-primary shrink-0 animate-spin" />
        ) : (
          <Home className="size-3.5 text-primary shrink-0" />
        )}
        <span className="text-sm font-medium truncate flex-1">{active?.name}</span>
        <ChevronDown className="size-3.5 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/10 animate-scale-in">
        <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t('yourHouseholds')}
        </p>
        <ul>
          {households.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                disabled={h.id === activeHouseholdId || isPending}
                onClick={() => {
                  if (detailsRef.current) detailsRef.current.open = false;
                  startTransition(() => switchAction(h.id));
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition hover:bg-accent disabled:cursor-default"
              >
                <Home className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-left">{h.name}</span>
                {h.id === activeHouseholdId && (
                  <Check className="size-3.5 text-primary shrink-0" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
