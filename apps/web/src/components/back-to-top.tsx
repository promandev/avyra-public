'use client';

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MAIN_SCROLL_ID } from '@/lib/scroll-target';

/**
 * Botón de volver arriba.
 *
 * En el panel de escritorio el scroll no es el de la ventana: la barra lateral
 * está fija y quien se desplaza es `<main>`. Por eso el listener se engancha a
 * ese contenedor cuando existe, y cae a `window` en el resto de páginas (login,
 * invitaciones) y en móvil, donde sí se desplaza la página entera.
 */
export function BackToTop() {
  const t = useTranslations('common');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Puede no existir todavía en el primer render de una ruta fuera del panel.
    const container = document.getElementById(MAIN_SCROLL_ID);

    // `main` sólo hace de contenedor de scroll a partir de md; por debajo su
    // scrollTop es siempre 0 y quien se mueve es la ventana. Escuchamos a los
    // dos y nos quedamos con el que tenga desplazamiento real.
    const offset = () => Math.max(window.scrollY, container?.scrollTop ?? 0);
    const onScroll = () => setVisible(offset() > 300);

    window.addEventListener('scroll', onScroll, { passive: true });
    container?.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      container?.removeEventListener('scroll', onScroll);
    };
  }, []);

  if (!visible) return null;

  const toTop = () => {
    const container = document.getElementById(MAIN_SCROLL_ID);
    if (container && container.scrollTop > 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <button
      onClick={toTop}
      aria-label={t('backToTop')}
      className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
