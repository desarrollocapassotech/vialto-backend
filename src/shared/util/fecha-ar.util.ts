/**
 * Días calendario en hora de Argentina.
 *
 * Nunca usar `new Date().toISOString().slice(0, 10)` ni `setUTCHours(0, 0, 0, 0)` sobre
 * "ahora" para obtener "hoy": dan el día UTC, que desde las 21 h de Argentina ya es
 * el día siguiente.
 */
const TZ_AR = "America/Argentina/Buenos_Aires";

/** `YYYY-MM-DD` del instante `d` en hora de Argentina (por defecto, hoy). */
export function ymdAr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_AR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Normaliza lo que manda el cliente a un día calendario guardado a medianoche UTC
 * (convención de las fechas sin hora: carga de combustible, corrección de km, etc.):
 * - `YYYY-MM-DD` o medianoche UTC exacta (lo que mandan app y front): se toma el día literal.
 * - Un instante con hora: se toma el día calendario en Argentina.
 * - Sin fecha: hoy en Argentina.
 */
export function fechaCalendarioAr(input?: string | null): Date {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T00:00:00.000Z`);
  }
  const instante = input ? new Date(input) : new Date();
  if (
    input &&
    instante.getUTCHours() === 0 &&
    instante.getUTCMinutes() === 0 &&
    instante.getUTCSeconds() === 0 &&
    instante.getUTCMilliseconds() === 0
  ) {
    return instante;
  }
  return new Date(`${ymdAr(instante)}T00:00:00.000Z`);
}
