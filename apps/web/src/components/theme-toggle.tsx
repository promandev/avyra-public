'use client';

import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useTheme } from '@/components/theme-provider';

export function ThemeToggle() {
  const t = useTranslations('theme');
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const isDark = resolvedTheme === 'dark';

  const toggle = useCallback(() => {
    const next = isDark ? 'light' : 'dark';

    // Si el navegador no soporta View Transitions, cambio directo
    if (!('startViewTransition' in document)) {
      setTheme(next);
      return;
    }

    // Cortina: oscuro → de arriba a abajo; claro → de abajo a arriba
    const clipStart = next === 'dark' ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)';

    const transition = document.startViewTransition(() => {
      setTheme(next);
    });

    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [clipStart, 'inset(0)'] },
        {
          duration: 600,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    });
  }, [isDark, setTheme]);

  // Evitar hydration mismatch
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="size-8" />;

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
      title={isDark ? t('switchToLight') : t('switchToDark')}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
