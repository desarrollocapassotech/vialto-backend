import { normalizarEstadoViaje } from '../viajes/viaje-estados';

/** Misma regla que `FacturacionService.computeImporte` para alinear importe con viajes. */
export function importeOperativoFactura(
  importeGuardado: number,
  viajes: { monto?: number | null }[],
): number {
  if (viajes.length === 0) return importeGuardado;
  return viajes.reduce((s, v) => s + (v.monto ?? 0), 0);
}

/**
 * Estado de negocio de la factura en lectura (el campo `estado` en BD no se mantiene al vencer).
 * - Cobrada si todos los viajes vinculados están cobrados (incl. códigos legados normalizados).
 * - Cobrada si los pagos registrados cubren el importe operativo.
 * - Vencida solo si no es cobrada y la fecha de vencimiento ya pasó.
 */
export function computeEstadoFacturaLectura(args: {
  viajes: { estado: string; monto?: number | null }[];
  fechaVencimiento: Date | null;
  importeGuardado: number;
  pagos: { importe: number }[];
}): 'cobrada' | 'vencida' | 'pendiente' {
  const importe = importeOperativoFactura(args.importeGuardado, args.viajes);

  if (
    args.viajes.length > 0 &&
    args.viajes.every((v) => normalizarEstadoViaje(v.estado) === 'cobrado')
  ) {
    return 'cobrada';
  }

  const totalPagado = args.pagos.reduce((s, p) => s + p.importe, 0);
  if (importe > 0 && totalPagado + 0.005 >= importe) {
    return 'cobrada';
  }

  if (args.fechaVencimiento && new Date(args.fechaVencimiento) <= new Date()) {
    return 'vencida';
  }
  return 'pendiente';
}
