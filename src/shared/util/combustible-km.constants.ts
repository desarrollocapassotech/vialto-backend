/**
 * Distancia máxima plausible entre dos cargas de combustible consecutivas de un
 * mismo vehículo (km). Compartida entre el motor de detección/corrección de datos
 * (scripts/fix-combustible-cargas-sospechosas.ts) y el cálculo de km recorridos del
 * dashboard (combustible.service.ts) para que ambos usen el mismo criterio de lo
 * que es una distancia "razonable" entre recargas.
 */
export const KM_DELTA_PLAUSIBLE_MAX = 5000;
