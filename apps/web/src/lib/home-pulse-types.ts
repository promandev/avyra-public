/**
 * Forma del "pulso" del hogar, sin nada de servidor.
 *
 * Vive aparte de `home-pulse.ts` porque la navegación es un componente de
 * cliente y necesita `EMPTY_PULSE` en tiempo de ejecución: importarlo del
 * módulo de consulta arrastraría Drizzle y el acceso a la base de datos al
 * paquete del navegador.
 */

export interface SubsystemPulse {
  /** Dispositivos dados de alta de este tipo. */
  total: number;
  /** Cuántos están encendidos / funcionando ahora. */
  active: number;
}

export interface HomePulse {
  lights: SubsystemPulse;
  heating: SubsystemPulse;
  cooling: SubsystemPulse;
  cameras: SubsystemPulse;
  /** Media de temperatura interior de los climatizadores que la reportan. */
  indoorTemperature: number | null;
  /** Algún subsistema está activo. Atajo para la capa ambiental. */
  anyActive: boolean;
}

export const EMPTY_PULSE: HomePulse = {
  lights: { total: 0, active: 0 },
  heating: { total: 0, active: 0 },
  cooling: { total: 0, active: 0 },
  cameras: { total: 0, active: 0 },
  indoorTemperature: null,
  anyActive: false,
};

// ─── Detalle por aparato para la portada ─────────────────────────────────────
//
// El pulso de arriba sólo cuenta. La portada en mosaico necesita saber QUÉ
// está encendido: el nombre de cada luz, la temperatura de cada estancia, el
// estado del robot. Sale de la misma lectura a Home Assistant que el pulso,
// así que no cuesta ninguna llamada extra.

export interface LightOverview {
  id: string;
  name: string;
  on: boolean;
  /** Tiene entidad de Home Assistant y por tanto se puede encender desde aquí. */
  controllable: boolean;
  /** Home Assistant la ve. Si no, se pinta apagada y deshabilitada. */
  available: boolean;
}

export interface ClimateOverview {
  id: string;
  name: string;
  /** Calefacción o aire. Decide el color del dial. */
  kind: 'heat' | 'cool';
  /** El aparato está encendido (su modo no es "off"). */
  power: boolean;
  /** Además está dando servicio ahora mismo. Ver `isRunning` en home-pulse. */
  running: boolean;
  current: number | null;
  /** Consigna ya corregida con la escala del termostato. */
  target: number | null;
}

export interface CameraOverview {
  id: string;
  name: string;
  enabled: boolean;
  /**
   * Último aviso registrado (movimiento, sonido, persona o animal) en ISO.
   * La portada no enseña imagen de las cámaras a propósito: esto es lo que
   * cuenta de ellas sin mostrar nada de dentro de casa.
   */
  lastEventAt: string | null;
  lastEventType: string | null;
}

export interface VacuumOverview {
  id: string;
  name: string;
  /** Estado crudo de Home Assistant: cleaning, docked, returning… */
  state: string;
  battery: number | null;
}

export interface HouseOverview {
  lights: LightOverview[];
  climate: ClimateOverview[];
  /** Sin la cámara de la tablet: no es un dispositivo del hogar. */
  cameras: CameraOverview[];
  vacuums: VacuumOverview[];
  indoorTemperature: number | null;
}

export const EMPTY_OVERVIEW: HouseOverview = {
  lights: [],
  climate: [],
  cameras: [],
  vacuums: [],
  indoorTemperature: null,
};
