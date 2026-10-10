/**
 * Concepto del cargo de cuenta corriente que genera una factura de cliente.
 * Sin número todavía (ej. borrador que recién se numera al emitir por ARCA)
 * no se muestra nada en su lugar — antes caía al id interno de la factura.
 */
export function conceptoCargoFactura(numero: string | null | undefined): string {
  const n = numero?.trim();
  return n ? `Venta automática por factura ${n}` : "Venta automática por factura";
}

/**
 * Lo que el cliente debe por la factura: neto + IVA persistido. `ivaMonto` solo se
 * llena en facturas por tramo de tenants sin ARCA (cobro = neto + IVA); en el resto
 * es null y el cargo queda en el neto, igual que el cobro.
 */
export function importeCargoFactura(f: { importe: number; ivaMonto?: number | null }): number {
  return Math.round((f.importe + (f.ivaMonto ?? 0)) * 100) / 100;
}

/** Estado del cargo según el cobro que muestra Facturas (`computeEstadoFacturaLectura`). */
export function estadoCargoFactura(cobrado: boolean, totalPagado: number): string {
  if (cobrado) return "cancelado";
  return totalPagado > 1e-6 ? "parcial" : "pendiente";
}
