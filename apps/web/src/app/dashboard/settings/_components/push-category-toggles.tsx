'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Cat, Flame, Lightbulb, Loader2, Printer, Snowflake } from 'lucide-react';

import { VacuumIcon } from '@/components/vacuum-icon';
import { PUSH_CATEGORIES, type PushCategory, type PushCategoryPrefs } from '@/lib/push-categories';
import { setPushCategory } from '../actions';

/** El mismo icono con el que aparece cada sección en el menú. */
const ICONS: Record<PushCategory, React.ComponentType<{ className?: string }>> = {
  cameras: Camera,
  lights: Lightbulb,
  heating: Flame,
  ac: Snowflake,
  vacuum: VacuumIcon,
  litter: Cat,
  printer: Printer,
};

interface Props {
  prefs: PushCategoryPrefs;
}

export function PushCategoryToggles({ prefs }: Props) {
  const t = useTranslations('account');
  // Se pinta el valor optimista para que el interruptor responda al instante;
  // si el servidor lo rechaza se vuelve a lo que había.
  const [local, setLocal] = useState(prefs);
  const [pendingCategory, setPendingCategory] = useState<PushCategory | null>(null);
  const [, startTransition] = useTransition();

  function toggle(category: PushCategory) {
    const next = !local[category];
    setLocal((prev) => ({ ...prev, [category]: next }));
    setPendingCategory(category);
    startTransition(async () => {
      const result = await setPushCategory(category, next);
      if (result.error) setLocal((prev) => ({ ...prev, [category]: !next }));
      setPendingCategory(null);
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground/70">{t('pushCategoriesDesc')}</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {PUSH_CATEGORIES.map((category) => {
          const Icon = ICONS[category];
          const on = local[category];
          return (
            <li key={category} className="flex items-center gap-3 px-3 py-2.5">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t(`pushCategory_${category}`)}</p>
                <p className="text-xs text-foreground/70">{t(`pushCategoryHint_${category}`)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={t(`pushCategory_${category}`)}
                onClick={() => toggle(category)}
                disabled={pendingCategory === category}
                className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                  on ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`absolute top-0.5 flex size-5 items-center justify-center rounded-full bg-background transition-all ${
                    on ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                >
                  {pendingCategory === category && <Loader2 className="size-3 animate-spin" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
