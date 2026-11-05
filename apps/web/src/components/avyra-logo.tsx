import type { CSSProperties } from 'react';

/**
 * Logotipo de Avyra.
 *
 * La marca es el fichero real de `public/icons`, el mismo del favicon. Antes
 * había aquí una recreación en SVG con trazos rectos y travesaño que no se
 * parecía al logo de verdad: la A real es de trazo redondeado, sin travesaño y
 * con los pies curvados hacia dentro.
 *
 * Se pinta como MÁSCARA en lugar de como imagen. El PNG es monocromo sobre
 * fondo transparente, así que su canal alfa ya es la silueta exacta: usándolo
 * de máscara sobre `currentColor` el logo hereda el color del texto, igual que
 * hacía el SVG. Eso evita tener que cargar dos ficheros (tinta clara y oscura)
 * y sobre todo evita envolverlo en un contenedor propio, que es lo que rompía
 * el posicionamiento cuando quien llama le pasa `absolute`.
 */

const MARK_MASK = '/icons/logo-mark-light.png';

interface LogoMarkProps {
  className?: string;
  /** Lado de la caja en píxeles. La marca se centra dentro. Por defecto 32. */
  size?: number;
}

export function AvyraLogoMark({ className, size = 32 }: LogoMarkProps) {
  const mask: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: 'currentColor',
    WebkitMaskImage: `url(${MARK_MASK})`,
    maskImage: `url(${MARK_MASK})`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  };

  // `inline-block` es sólo el valor por defecto: las utilidades de display que
  // pase quien llama (`hidden`, `md:block`) ganan por orden en la hoja.
  return <span className={`inline-block shrink-0 ${className ?? ''}`} style={mask} aria-hidden="true" />;
}

interface WordmarkProps {
  className?: string;
}

/**
 * El texto AVYRA. Se queda como texto y no como imagen: escala sin perder
 * nitidez, se puede seleccionar y hereda el color del tema.
 */
export function AvyraWordmark({ className }: WordmarkProps) {
  return (
    <span
      className={className}
      style={{
        fontWeight: 400,
        letterSpacing: '0.28em',
        textTransform: 'uppercase',
        fontFamily: 'inherit',
        lineHeight: 1,
      }}
    >
      AVYRA
    </span>
  );
}

interface AvyraLogoProps {
  /** Sólo la marca, sólo el texto, o ambos. Por defecto "full". */
  variant?: 'full' | 'mark' | 'wordmark';
  /** Lado de la marca en píxeles. Por defecto 28. */
  markSize?: number;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}

export function AvyraLogo({
  variant = 'full',
  markSize = 28,
  className,
  markClassName,
  wordmarkClassName,
}: AvyraLogoProps) {
  if (variant === 'mark') {
    return <AvyraLogoMark size={markSize} className={markClassName ?? className} />;
  }
  if (variant === 'wordmark') {
    return <AvyraWordmark className={wordmarkClassName ?? className} />;
  }
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <AvyraLogoMark size={markSize} className={markClassName} />
      <AvyraWordmark className={wordmarkClassName} />
    </span>
  );
}
