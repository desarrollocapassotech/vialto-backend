/**
 * Observaciones de una factura (renglones de texto sin importe, impresos en el PDF debajo
 * de los viajes). Se guardan sin espacios de más y sin renglones vacíos.
 */
export function normalizarObservacionesFactura(
  observaciones: readonly unknown[] | null | undefined,
): string[] {
  if (!Array.isArray(observaciones)) return [];
  return observaciones
    .map((o) => (typeof o === 'string' ? o.replace(/\s+/g, ' ').trim() : ''))
    .filter((o) => o.length > 0);
}
