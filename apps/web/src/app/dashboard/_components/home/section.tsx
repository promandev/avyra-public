import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';

/**
 * Grupo de la portada: un titular, un recuento opcional y el enlace a su
 * sección. No es una tarjeta: las piezas de dentro ya son superficies, y
 * meterlas en otra las anidaría.
 */
export function Section({
  title,
  meta,
  href,
  hrefLabel,
  className = '',
  children,
}: {
  title: string;
  /** Recuento corto junto al titular ("3/6"). */
  meta?: ReactNode;
  href?: string;
  hrefLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 ${className}`}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {title}
          {meta && <span className="tnum ml-2 text-sm font-normal text-muted-foreground">{meta}</span>}
        </h2>
        {href && hrefLabel && (
          <Link
            href={href as Route}
            className="-mr-2 rounded-lg px-2 py-1 text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {hrefLabel}
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
