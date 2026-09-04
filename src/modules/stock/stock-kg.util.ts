/**
 * Utilidades para calcular el peso en kilos de bultos/unidades sueltas,
 */

/**
 * Calcula el peso en kg de una cantidad de bultos + unidades sueltas.
 *
 * @param cantidadBultos Cantidad de bultos/pallets completos.
 * @param cantidadSueltas Cantidad de unidades sueltas (fuera de bulto).
 * @param unidadesPorBulto Cuántas unidades trae cada bulto (de ProductoPresentacion).
 * @param pesoUnitarioKg Peso de una unidad individual (de Producto).
 */
export function calcularKg(
  cantidadBultos: number,
  cantidadSueltas: number,
  unidadesPorBulto: number,
  pesoUnitarioKg: number,
): number {
  const bultos = cantidadBultos ?? 0;
  const sueltas = cantidadSueltas ?? 0;
  const porBulto = unidadesPorBulto ?? 0;
  const pesoUnitario = pesoUnitarioKg ?? 0;

  const totalUnidades = bultos * porBulto + sueltas;
  return totalUnidades * pesoUnitario;
}
