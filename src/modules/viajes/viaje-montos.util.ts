/**
 * Resuelve el monto efectivo a persistir a partir del monto directo o del desglose (cantidad x precio unitario).
 *
 * - Si vienen cantidad y precio unitario, prevalece el producto del desglose.
 * - Si no vino monto directo y el precio unitario es null, se interpreta como vaciado del importe.
 * - En cualquier otro caso, se respeta el monto directo enviado (número, null o undefined).
 */
export function resolverMontoInput(
  montoDirecto: number | null | undefined,
  cantidad: number | null | undefined,
  precioUnitario: number | null | undefined,
): number | null | undefined {
  if (cantidad != null && precioUnitario != null) {
    return Math.round(cantidad * precioUnitario * 100) / 100;
  }
  if (montoDirecto === undefined && precioUnitario === null) {
    return null;
  }
  return montoDirecto;
}
