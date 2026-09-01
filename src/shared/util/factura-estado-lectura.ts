/**
 * Utilidades puras de lectura del estado de una factura.
 * Usadas por: facturacion, dashboard, platform.
 */

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function importeNetoViaje(v: {
  monto?: number | null;
  cantidadFactura?: number | null;
  precioUnitarioFactura?: number | null;
}): number {
  if (v.cantidadFactura != null && v.precioUnitarioFactura != null) {
    return roundMoney2(v.cantidadFactura * v.precioUnitarioFactura);
  }
  return v.monto ?? 0;
}

export type FacturaTramoCobro = {
  viajeId: string;
  monto: number;
  ivaPct: number;
};

export type FacturaCobroOpts = {
  /**
   * Tenant con `emision-facturas-arca`: el cobro sigue midiendo el neto.
   * El IVA de tramos solo entra al cobro en facturas por tramo de tenants
   * que no emiten ante AFIP (caso Uruguay).
   */
  tieneArca?: boolean;
  facturarPorTramo?: boolean;
  tramos?: FacturaTramoCobro[];
  ivaPctCabecera?: number | null;
};

export function cobroOptsDeFactura(
  f: {
    facturarPorTramo?: boolean | null;
    ivaPct?: number | null;
    tramos?: FacturaTramoCobro[] | null;
  },
  tieneArca: boolean,
): FacturaCobroOpts {
  return {
    tieneArca,
    facturarPorTramo: Boolean(f.facturarPorTramo),
    tramos: f.tramos ?? undefined,
    ivaPctCabecera: f.ivaPct,
  };
}

type ViajeCobro = {
  id?: string;
  monto?: number | null;
  cantidadFactura?: number | null;
  precioUnitarioFactura?: number | null;
};

/** Neto sin IVA: tramos + viajes sin tramo, o suma de viajes (cantidad×precio si hay). */
export function importeNetoFactura(
  importeGuardado: number,
  viajes: ViajeCobro[],
  opts?: Pick<FacturaCobroOpts, 'facturarPorTramo' | 'tramos'>,
): number {
  const tramos = opts?.tramos ?? [];
  if (opts?.facturarPorTramo && tramos.length > 0) {
    const viajeIdsConTramo = new Set(tramos.map((t) => t.viajeId));
    const sumaTramos = tramos.reduce((s, t) => s + (t.monto ?? 0), 0);
    const sumaViajesSinTramo = viajes
      .filter((v) => v.id && !viajeIdsConTramo.has(v.id))
      .reduce((s, v) => s + importeNetoViaje(v), 0);
    return roundMoney2(sumaTramos + sumaViajesSinTramo);
  }
  if (viajes.length === 0) return importeGuardado;
  return viajes.reduce((s, v) => s + importeNetoViaje(v), 0);
}

/** Total con IVA de una factura por tramo. */
export function importeTotalConIvaPorTramo(
  importeNeto: number,
  tramos: FacturaTramoCobro[],
  ivaPctCabecera?: number | null,
): number {
  const sumaTramos = roundMoney2(tramos.reduce((s, t) => s + t.monto, 0));
  const undivided = Math.max(0, roundMoney2(importeNeto - sumaTramos));
  const ivaTramos = tramos.reduce(
    (s, t) => roundMoney2(s + roundMoney2((t.monto * t.ivaPct) / 100)),
    0,
  );
  const ivaUndivided = roundMoney2(
    (undivided * (Number(ivaPctCabecera) || 0)) / 100,
  );
  return roundMoney2(importeNeto + ivaTramos + ivaUndivided);
}

/**
 * Monto contra el que se mide el cobro.
 * Sin tramos / tenant ARCA: neto. Por tramo sin ARCA: neto + IVA de cada tramo.
 */
export function importeOperativoFactura(
  importeGuardado: number,
  viajes: ViajeCobro[],
  opts?: FacturaCobroOpts,
): number {
  const neto = importeNetoFactura(importeGuardado, viajes, opts);
  if (
    opts?.tieneArca ||
    !opts?.facturarPorTramo ||
    !(opts.tramos && opts.tramos.length > 0)
  ) {
    return neto;
  }
  return importeTotalConIvaPorTramo(neto, opts.tramos, opts.ivaPctCabecera);
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
  cobrado: boolean;
  vencida: boolean;
}

export function computeEstadoFacturaLectura(args: {
  viajes: Array<{
    id?: string;
    facturacionEstado: string;
    monto?: number | null;
    cantidadFactura?: number | null;
    precioUnitarioFactura?: number | null;
  }>;
  fechaVencimiento: Date | null;
  importeGuardado: number;
  pagos: { importe: number }[];
  arcaEstado: string | null;
  tieneArca: boolean;
  facturarPorTramo?: boolean;
  tramos?: FacturaTramoCobro[];
  ivaPctCabecera?: number | null;
}): FacturaEstadoResult {
  let estado: FacturaEstadoLectura = 'facturado';
  if (args.tieneArca) {
    if (args.arcaEstado == null) estado = 'borrador';
    else if (args.arcaEstado === 'pendiente_cae') estado = 'esperando_afip';
    else if (args.arcaEstado === 'error') estado = 'error_afip';
    else if (args.arcaEstado === 'anulado') estado = 'anulado';
  }

  const cobroOpts: FacturaCobroOpts = {
    tieneArca: args.tieneArca,
    facturarPorTramo: args.facturarPorTramo,
    tramos: args.tramos,
    ivaPctCabecera: args.ivaPctCabecera,
  };
  const importe = importeOperativoFactura(
    args.importeGuardado,
    args.viajes,
    cobroOpts,
  );
  const totalPagado = args.pagos.reduce((s, p) => s + p.importe, 0);
  const cobradoPorPagos = importe > 0 && totalPagado + 0.005 >= importe;
  const cobradoPorViajes =
    args.viajes.length > 0 &&
    args.viajes.every((v) => v.facturacionEstado === 'cobrado');
  const porTramoSinArca =
    !args.tieneArca &&
    Boolean(args.facturarPorTramo) &&
    (args.tramos?.length ?? 0) > 0;
  const cobrado = porTramoSinArca
    ? cobradoPorPagos
    : cobradoPorViajes || cobradoPorPagos;

  const vencida =
    !cobrado &&
    estado === 'facturado' &&
    args.fechaVencimiento != null &&
    new Date(args.fechaVencimiento) <= new Date();

  return { estado, cobrado, vencida };
}
