import { roundMoney2 } from '../../shared/util/factura-estado-lectura';

export type PagoParaReparto = {
  id: string;
  /** Lo que le queda sin imputar al cobro/pago (importe − imputado), no su total. */
  disponible: number;
  fecha: Date | string;
  createdAt: Date | string;
};

/**
 * Reparto de una imputación con varios cobros/pagos: se consume primero el de menor
 * disponible (desempate: el más antiguo por fecha y después por carga) y el siguiente
 * cubre solo lo que falta, hasta lo pendiente del comprobante. Lo que sobra queda
 * disponible en el cobro mayor. Si entre todos no alcanzan, se usan por completo y el
 * comprobante queda parcial.
 *
 * Espejada en el front (`repartirImputacion` en `lib/cuentaCorriente.ts`) para el
 * resumen previo — mantener ambas iguales.
 */
export function repartirImputacion(
  pendienteCargo: number,
  pagos: PagoParaReparto[],
): Array<{ pagoId: string; importe: number }> {
  const ordenados = [...pagos].sort(
    (a, b) =>
      a.disponible - b.disponible ||
      new Date(a.fecha).getTime() - new Date(b.fecha).getTime() ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  let restante = roundMoney2(Math.max(0, pendienteCargo));
  return ordenados.map((p) => {
    const importe = roundMoney2(Math.max(0, Math.min(p.disponible, restante)));
    restante = roundMoney2(restante - importe);
    return { pagoId: p.id, importe };
  });
}
