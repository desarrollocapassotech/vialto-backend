/** Solo fecha calendario `YYYY-MM-DD` (sin zona). Se interpreta como inicio de ese día en Argentina (UTC-3 fijo). */
const FECHA_SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte el string de `fecha` del cliente en `Date` para persistir en PostgreSQL.
 * - `YYYY-MM-DD` (legacy): medianoche en America/Argentina/Buenos_Aires vía offset `-03:00`
 *   (evita el bug de `new Date('YYYY-MM-DD')` = medianoche UTC y el día “saltado” en AR).
 * - ISO 8601 completo (recomendado, p. ej. `toISOString()` desde `datetime-local` en el navegador).
 */
export function parseFechaMovimientoStock(raw: string): Date {
  const s = (raw ?? '').trim();
  if (!s) return new Date(NaN);
  if (FECHA_SOLO_DIA.test(s)) {
    return new Date(`${s}T00:00:00-03:00`);
  }
  return new Date(s);
}

/** Año civil en Buenos Aires (útil para correlativo de remito de egreso). */
export function yearInBuenosAires(d: Date): number {
  const y = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
  }).format(d);
  return parseInt(y, 10);
}
