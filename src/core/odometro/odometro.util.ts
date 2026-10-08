import type { LecturaKm } from './odometro.types';

const MS_DIA = 24 * 60 * 60 * 1000;

/** Ventana y umbrales del km/día (ver docs/mantenimiento-plan.md, sección 3). */
export const KM_POR_DIA_VENTANA_DIAS = 60;
export const KM_POR_DIA_MIN_LECTURAS = 3;
export const KM_POR_DIA_MIN_RANGO_DIAS = 14;

function diaUtc(d: Date): number {
  return Math.floor(d.getTime() / MS_DIA);
}

/**
 * Orden cronológico entre lecturas de distintas fuentes. Las cargas tienen hora real, pero
 * las ediciones de km y las OT se guardan a las 00:00 UTC: comparar la `fecha` cruda pondría
 * una edición hecha a la tarde antes que una carga de la mañana del mismo día. Por eso:
 * distinto día → gana el día; mismo día entre cargas → hora real y después `createdAt`;
 * mismo día entre fuentes distintas (o sin hora) → `createdAt`.
 */
export function compararLecturas(a: LecturaKm, b: LecturaKm): number {
  const dia = diaUtc(a.fecha) - diaUtc(b.fecha);
  if (dia !== 0) return dia;
  if (a.fuente === 'carga' && b.fuente === 'carga') {
    const hora = a.fecha.getTime() - b.fecha.getTime();
    if (hora !== 0) return hora;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export function ordenarLecturas(lecturas: LecturaKm[]): LecturaKm[] {
  return [...lecturas].sort(compararLecturas);
}

export function ultimaLectura(lecturas: LecturaKm[]): LecturaKm | null {
  let ultima: LecturaKm | null = null;
  for (const l of lecturas) {
    if (!ultima || compararLecturas(l, ultima) > 0) ultima = l;
  }
  return ultima;
}

/**
 * Km recorridos por día con las lecturas de los últimos 60 días:
 * (kmMax − kmMin) / días entre la lectura más vieja y la más nueva del período.
 * `null` si hay menos de 3 lecturas, si el rango es menor a 14 días o si el resultado es ≤ 0.
 * El fallback `'vehiculo'` no es una lectura real y no cuenta.
 */
export function calcularKmPorDia(lecturas: LecturaKm[], hoy: Date): number | null {
  const desde = hoy.getTime() - KM_POR_DIA_VENTANA_DIAS * MS_DIA;
  const ventana = lecturas.filter(
    (l) => l.fuente !== 'vehiculo' && l.fecha.getTime() >= desde && l.fecha.getTime() <= hoy.getTime(),
  );
  if (ventana.length < KM_POR_DIA_MIN_LECTURAS) return null;

  const tiempos = ventana.map((l) => l.fecha.getTime());
  const dias = (Math.max(...tiempos) - Math.min(...tiempos)) / MS_DIA;
  if (dias < KM_POR_DIA_MIN_RANGO_DIAS) return null;

  const kms = ventana.map((l) => l.km);
  const kmPorDia = (Math.max(...kms) - Math.min(...kms)) / dias;
  return kmPorDia > 0 ? kmPorDia : null;
}
