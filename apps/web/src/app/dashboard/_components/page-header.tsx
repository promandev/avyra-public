import type { ReactNode } from 'react';

/**
 * Cabecera común de las secciones del panel.
 *
 * Antes cada página repetía el mismo bloque con `text-3xl`, así que cualquier
 * ajuste de jerarquía había que hacerlo en cinco sitios. Usa la escala de
 * titular del sistema, un escalón por debajo del héroe de la portada.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Botón principal de la sección, alineado a la derecha. */
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex animate-fade-in-down flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-display-sm font-semibold">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
