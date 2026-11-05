import type { CSSProperties } from 'react';

import type { HomePulse } from '@/lib/home-pulse-types';

/**
 * Capa ambiental del sistema "Hogar Vivo".
 *
 * Pinta detrás de todo un halo por subsistema activo: dorado con las luces,
 * ámbar con la calefacción, cian con el aire. Las capas están siempre en el
 * DOM y sólo cambia su opacidad, así que al encender algo el fondo funde de
 * un tono a otro en vez de saltar.
 */

/** Más dispositivos encendidos → halo algo más presente, con tope en 1. */
function intensity(active: number): number {
  if (active <= 0) return 0;
  return Math.min(1, 0.6 + (active - 1) * 0.14);
}

function layerStyle(active: number): CSSProperties {
  return { ['--layer-intensity' as string]: intensity(active).toFixed(2) };
}

export function AmbientBackdrop({ pulse }: { pulse: HomePulse }) {
  return (
    <div className="ambient-root" aria-hidden="true">
      <div className="ambient-layer ambient-brand" />
      <div
        className="ambient-layer ambient-light"
        data-on={pulse.lights.active > 0}
        style={layerStyle(pulse.lights.active)}
      />
      <div
        className="ambient-layer ambient-heat"
        data-on={pulse.heating.active > 0}
        style={layerStyle(pulse.heating.active)}
      />
      <div
        className="ambient-layer ambient-cool"
        data-on={pulse.cooling.active > 0}
        style={layerStyle(pulse.cooling.active)}
      />
      <div className="ambient-grain" />
    </div>
  );
}
