/**
 * Concepto del cargo de cuenta corriente que genera una factura de cliente.
 * Sin número todavía (ej. borrador que recién se numera al emitir por ARCA)
 * no se muestra nada en su lugar — antes caía al id interno de la factura.
 */
export function conceptoCargoFactura(numero: string | null | undefined): string {
  const n = numero?.trim();
  return n ? `Venta automática por factura ${n}` : "Venta automática por factura";
}
