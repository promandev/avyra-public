import Link from 'next/link';
import type { Route } from 'next';
import type { ComponentType, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

/**
 * Pieza del mosaico de la portada.
 *
 * Todas comparten cabecera: un rótulo pequeño con su icono y, si la pieza
 * resume una sección, un enlace discreto para ir a ella. Así el mosaico se
 * lee como un sistema y no como tarjetas sueltas.
 */
export function Tile({
  title,
  icon: Icon,
  href,
  hrefLabel,
  className = '',
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  href?: string;
  hrefLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`glass relative flex min-w-0 flex-col overflow-hidden rounded-3xl p-5 md:p-6 ${className}`}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="size-4" />
          {title}
        </h2>
        {href && hrefLabel && (
          <Link
            href={href as Route}
            className="group inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            {hrefLabel}
            <ArrowUpRight className="size-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
