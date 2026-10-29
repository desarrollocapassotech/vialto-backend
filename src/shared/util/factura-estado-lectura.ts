import { fechaCalendarioAr } from "./fecha-ar.util";

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
  /**
   * IVA persistido al guardar la factura (`Factura.ivaMonto`).
   * Si viene, el cobro no reconstruye la cuenta tramo a tramo.
   * `null`/`undefined` = factura vieja todavía no backfilleada: se calcula.
   */
  ivaMontoGuardado?: number | null;
};

export function cobroOptsDeFactura(
  f: {
    facturarPorTramo?: boolean | null;
    ivaPct?: number | null;
    tramos?: FacturaTramoCobro[] | null;
    ivaMonto?: number | null;
  },
  tieneArca: boolean,
): FacturaCobroOpts {
  return {
    tieneArca,
    facturarPorTramo: Boolean(f.facturarPorTramo),
    tramos: f.tramos ?? undefined,
    ivaPctCabecera: f.ivaPct,
    ivaMontoGuardado: f.ivaMonto,
  };
}

type ViajeCobro = {
  id?: string;
  monto?: number | null;
  cantidadFactura?: number | null;
  precioUnitarioFactura?: number | null;
};

/**
 * Neto sin IVA.
 * Al facturar por tramo, la suma de los tramos pisa el monto del viaje.
 * Para viajes sin tramo cargado, se mantiene el importe neto del viaje.
 */
export function importeNetoFactura(
  importeGuardado: number,
  viajes: ViajeCobro[],
  opts?: Pick<FacturaCobroOpts, "facturarPorTramo" | "tramos">,
): number {
  if (opts?.facturarPorTramo && opts.tramos && opts.tramos.length > 0) {
    const viajeIdsConTramo = new Set(
      opts.tramos.map((t) => t.viajeId).filter(Boolean),
    );
    const sumaTramos = roundMoney2(
      opts.tramos.reduce((s, t) => s + (t.monto ?? 0), 0),
    );
    const sumaViajesSinTramo = roundMoney2(
      viajes
        .filter((v) => !v.id || !viajeIdsConTramo.has(v.id))
        .reduce((s, v) => s + importeNetoViaje(v), 0),
    );
    return roundMoney2(sumaTramos + sumaViajesSinTramo);
  }
  if (viajes.length === 0) return importeGuardado;
  return roundMoney2(viajes.reduce((s, v) => s + importeNetoViaje(v), 0));
}

/**
 * IVA de una factura por tramo: suma el IVA de cada tramo cargado.
 * Si se pasan viajes vinculados, los viajes que no tienen ningún tramo cargado
 * usan el IVA de cabecera; el remanente no cubierto de viajes con tramo
 * corresponde al componente exento/internacional y no devenga IVA (0%).
 */
export function ivaMontoDeTramos(
  importeNeto: number,
  tramos: FacturaTramoCobro[],
  ivaPctCabecera?: number | null,
  viajes?: ViajeCobro[],
): number {
  if (tramos.length === 0) {
    return roundMoney2((importeNeto * (Number(ivaPctCabecera) || 0)) / 100);
  }
  const ivaTramos = tramos.reduce(
    (s, t) => roundMoney2(s + roundMoney2((t.monto * t.ivaPct) / 100)),
    0,
  );
  if (viajes && viajes.length > 0) {
    const viajeIdsConTramo = new Set(
      tramos.map((t) => t.viajeId).filter(Boolean),
    );
    const viajesSinTramo = viajes.filter(
      (v) => v.id && !viajeIdsConTramo.has(v.id),
    );
    const sumaViajesSinTramo = roundMoney2(
      viajesSinTramo.reduce((s, v) => s + importeNetoViaje(v), 0),
    );
    const ivaViajesSinTramo = roundMoney2(
      (sumaViajesSinTramo * (Number(ivaPctCabecera) || 0)) / 100,
    );
    return roundMoney2(ivaTramos + ivaViajesSinTramo);
  }
  return roundMoney2(ivaTramos);
}

/** Total con IVA de una factura por tramo. */
export function importeTotalConIvaPorTramo(
  importeNeto: number,
  tramos: FacturaTramoCobro[],
  ivaPctCabecera?: number | null,
  viajes?: ViajeCobro[],
): number {
  return roundMoney2(
    importeNeto + ivaMontoDeTramos(importeNeto, tramos, ivaPctCabecera, viajes),
  );
}

/**
 * Monto contra el que se mide el cobro (total real con IVA incluido).
 * Aplica tanto a empresas con ARCA como sin ARCA.
 * Si es por tramos, suma el IVA de los tramos cargados y el resto con la alícuota de cabecera.
 * Si no es por tramos, suma `ivaMontoGuardado` o calcula el IVA según `ivaPctCabecera`.
 * En facturas exentas (0%), preserva el neto sin cambios.
 */
export function importeOperativoFactura(
  importeGuardado: number,
  viajes: ViajeCobro[],
  opts?: FacturaCobroOpts,
): number {
  const neto = importeNetoFactura(importeGuardado, viajes, opts);
  if (opts?.facturarPorTramo && opts.tramos && opts.tramos.length > 0) {
    if (opts.ivaMontoGuardado != null && Number.isFinite(opts.ivaMontoGuardado)) {
      return roundMoney2(neto + opts.ivaMontoGuardado);
    }
    return importeTotalConIvaPorTramo(neto, opts.tramos, opts.ivaPctCabecera, viajes);
  }
  if (opts?.ivaMontoGuardado != null && Number.isFinite(opts.ivaMontoGuardado)) {
    return roundMoney2(neto + opts.ivaMontoGuardado);
  }
  const pct = Number(opts?.ivaPctCabecera);
  const iva = Number.isFinite(pct) && pct > 0 ? roundMoney2((neto * pct) / 100) : 0;
  return roundMoney2(neto + iva);
}

/** Ciclo de vida del comprobante — un solo valor a la vez, nunca "cobrado" (ver `cobrado` abajo). */
export type FacturaEstadoLectura =
  | "borrador"
  | "esperando_afip"
  | "facturado"
  | "error_afip"
  | "anulado";

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
  fechaVencimiento: Date | string | null;
  importeGuardado: number;
  pagos: { importe: number }[];
  arcaEstado: string | null;
  tieneArca: boolean;
  /** `Factura.manual`: hecha por fuera del sistema, se lee como en una empresa sin ARCA. */
  manual?: boolean | null;
  facturarPorTramo?: boolean;
  tramos?: FacturaTramoCobro[];
  ivaPctCabecera?: number | null;
  ivaMontoGuardado?: number | null;
  /** Opcional: día de referencia para evaluar vencimiento (por defecto hoy en Argentina). */
  hoyReferencia?: Date | string | null;
}): FacturaEstadoResult {
  let estado: FacturaEstadoLectura = "facturado";
  if (args.tieneArca && !args.manual) {
    if (args.arcaEstado == null) estado = "borrador";
    else if (args.arcaEstado === "pendiente_cae") estado = "esperando_afip";
    else if (args.arcaEstado === "error") estado = "error_afip";
    else if (args.arcaEstado === "anulado") estado = "anulado";
  }

  const cobroOpts: FacturaCobroOpts = {
    tieneArca: args.tieneArca && !args.manual,
    facturarPorTramo: args.facturarPorTramo,
    tramos: args.tramos,
    ivaPctCabecera: args.ivaPctCabecera,
    ivaMontoGuardado: args.ivaMontoGuardado,
  };
  const importe = importeOperativoFactura(
    args.importeGuardado,
    args.viajes,
    cobroOpts,
  );
  const totalPagado = args.pagos.reduce((s, p) => s + p.importe, 0);
  const cobradoPorPagos = importe > 0 && totalPagado + 0.005 >= importe;
  // Fallback para datos históricos sin registros de Pago: si todos sus viajes ya estaban en cobrado
  const cobradoPorViajes =
    args.pagos.length === 0 &&
    args.viajes.length > 0 &&
    args.viajes.every((v) => v.facturacionEstado === "cobrado");
  const cobrado = cobradoPorPagos || cobradoPorViajes;

  let vencida = false;
  if (!cobrado && estado === "facturado" && args.fechaVencimiento != null) {
    const hoy = args.hoyReferencia
      ? fechaCalendarioAr(
          args.hoyReferencia instanceof Date
            ? args.hoyReferencia.toISOString()
            : args.hoyReferencia,
        )
      : fechaCalendarioAr();
    const vto = fechaCalendarioAr(
      args.fechaVencimiento instanceof Date
        ? args.fechaVencimiento.toISOString()
        : args.fechaVencimiento,
    );
    vencida = vto < hoy;
  }

  return { estado, cobrado, vencida };
}
