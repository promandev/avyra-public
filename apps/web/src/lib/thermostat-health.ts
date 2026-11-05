/**
 * Cuánto puede pasar sin noticias de un termostato antes de dar lo que se ve
 * por viejo. El Tuya del salón, sano, nunca pasó de 3 h sin informar (histórico
 * de HA, octubre 2026); cuando su sesión en la nube murió, HA siguió enseñando
 * el último estado durante días como si fuera de ahora.
 *
 * Sin dependencias a propósito: lo usan la tarjeta (cliente) y los avisos
 * (servidor).
 */
export const THERMOSTAT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
