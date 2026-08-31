/**
 * Utilidades puras de lectura del estado de una factura.
 * Usadas por: facturacion, dashboard, platform.
 */

/** Misma regla que `FacturacionService.computeImporte` para alinear importe con viajes. */
export function importeOperativoFactura(
  importeGuardado: number,
  viajes: Array<{
    monto?: number | null;
    cantidadFactura?: number | null;
    precioUnitarioFactura?: number | null;
  }>,
): number {
  if (viajes.length === 0) return importeGuardado;
  return viajes.reduce((s, v) => {
    if (v.cantidadFactura != null && v.precioUnitarioFactura != null) {
      return s + Math.round(v.cantidadFactura * v.precioUnitarioFactura * 100) / 100;
    }
    return s + (v.monto ?? 0);
  }, 0);
}

/** Ciclo de vida del comprobante — un solo valor a la vez, nunca "cobrado" (ver `cobrado` abajo). */
export type FacturaEstadoLectura =
  | 'borrador'
  | 'esperando_afip'
  | 'facturado'
  | 'error_afip'
  | 'anulado';

export interface FacturaEstadoResult {
  estado: FacturaEstadoLectura;
  /** Eje independiente del ciclo de vida: se puede estar cobrado en cualquier estado (ej. cobrado antes de anular). */
  cobrado: boolean;
  /** Solo relevante mientras no está cobrado y ya se llegó a "facturado" (con CAE si aplica). */
  vencida: boolean;
}

/**
 * Estado de negocio de la factura en lectura. `estado` (ciclo de vida) y `cobrado`/
 * `vencida` (cobro) son ejes independientes — la UI los muestra como badges separados,
 * uno nunca reemplaza al otro. Sigue el mismo orden de prioridad para `estado` que
 * `mapFacturacionEstado` en `modules/viajes/viaje-estado-financiero.ts` — mantener
 * ambos sincronizados si cambia la regla.
 */
export function computeEstadoFacturaLectura(args: {
  viajes: { facturacionEstado: string; monto?: number | null }[];
  fechaVencimiento: Date | null;
  importeGuardado: number;
  pagos: { importe: number }[];
  arcaEstado: string | null;
  tieneArca: boolean;
}): FacturaEstadoResult {
  let estado: FacturaEstadoLectura = 'facturado';
  if (args.tieneArca) {
    if (args.arcaEstado == null) estado = 'borrador';
    else if (args.arcaEstado === 'pendiente_cae') estado = 'esperando_afip';
    else if (args.arcaEstado === 'error') estado = 'error_afip';
    else if (args.arcaEstado === 'anulado') estado = 'anulado';
  }

  const importe = importeOperativoFactura(args.importeGuardado, args.viajes);
  const totalPagado = args.pagos.reduce((s, p) => s + p.importe, 0);
  const cobrado =
    (args.viajes.length > 0 &&
      args.viajes.every((v) => v.facturacionEstado === 'cobrado')) ||
    (importe > 0 && totalPagado + 0.005 >= importe);

  const vencida =
    !cobrado &&
    estado === 'facturado' &&
    args.fechaVencimiento != null &&
    new Date(args.fechaVencimiento) <= new Date();

  return { estado, cobrado, vencida };
}
