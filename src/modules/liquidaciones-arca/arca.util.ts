/**
 * Utilidades operativas y de negocio para la integración ARCA / AFIP.
 */

/**
 * NOTA DE DISEÑO: En el modelo de base de datos, `factura.numero` es un campo de texto libre
 * (`String`) sin formato garantizado en el DTO de creación para poder dar soporte a facturas
 * de compras y transportistas con nomenclaturas muy variadas (incluyendo letras, barras o guiones).
 *
 * Como no existe una columna numérica estructurada para el correlativo antes de la emisión,
 * esta función extrae de forma tolerante el sufijo numérico final de la cadena para poder
 * verificar la correlatividad con AFIP durante la emisión.
 *
 * Ejemplos de formatos admitidos:
 *  - "0001-00000045" -> 45
 *  - "FAC/120"       -> 120
 *  - "A-12"          -> 12
 *  - "12345"         -> 12345
 * Retorna NaN si no contiene dígitos al final, es vacío o es nulo.
 *
 * @param numero String que representa el número de factura cargado en el sistema
 * @returns El número secuencial como un entero (number), o NaN si no se pudo parsear.
 */
export function parseNumeroFactura(numero: string): number {
  if (!numero) return NaN;
  const match = numero.trim().match(/\d+$/);
  return match ? Number(match[0]) : NaN;
}
