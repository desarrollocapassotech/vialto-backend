/** Letra de un comprobante AFIP por su `cbteTipo` (facturas, notas de crédito y de débito). */
const LETRA_POR_CBTE_TIPO: Record<number, string> = {
  1: "A", 2: "A", 3: "A",
  6: "B", 7: "B", 8: "B",
  11: "C", 12: "C", 13: "C",
  51: "M", 52: "M", 53: "M",
};
const NOTA_DEBITO = new Set([2, 7, 12, 52]);
const NOTA_CREDITO = new Set([3, 8, 13, 53]);

export function letraComprobante(cbteTipo: number | null | undefined): string | null {
  return cbteTipo != null ? (LETRA_POR_CBTE_TIPO[cbteTipo] ?? null) : null;
}

/**
 * Concepto del cargo de cuenta corriente que genera una factura de cliente: "FACTURA",
 * con la letra si se conoce (ej. "FACTURA A"). Sin número: va en la columna Comprobante.
 */
export function conceptoCargoFactura(cbteTipo?: number | null): string {
  const letra = letraComprobante(cbteTipo);
  return letra ? `FACTURA ${letra}` : "FACTURA";
}

/**
 * Concepto del crédito (Haber) que compensa un comprobante anulado/eliminada (VTO-431):
 * si se anuló con una nota de crédito/débito de AFIP, solo esa nota (ej. "NOTA DE CRÉDITO
 * A"); si no (anulación interna o manual), "ANULACION". Se usa para facturas y
 * liquidaciones; el número va en Comprobante.
 */
export function conceptoAnulacion(cbteTipoAnulacion?: number | null): string {
  if (cbteTipoAnulacion == null) return "ANULACION";
  const tipo = NOTA_DEBITO.has(cbteTipoAnulacion)
    ? "NOTA DE DÉBITO"
    : NOTA_CREDITO.has(cbteTipoAnulacion)
      ? "NOTA DE CRÉDITO"
      : null;
  if (!tipo) return "ANULACION";
  const letra = letraComprobante(cbteTipoAnulacion);
  return `${tipo}${letra ? ` ${letra}` : ""}`;
}

import {
  FacturaTramoCobro,
  importeTotalConIvaPorTramo,
  roundMoney2,
} from "../../shared/util/factura-estado-lectura";

/**
 * Lo que el cliente debe por la factura: total real con IVA incluido (tanto con ARCA como sin ARCA).
 * Si `ivaMonto` está persistido, suma neto + IVA. En facturas por tramo sin persistir, calcula tramo a tramo.
 * En facturas estándar sin `ivaMonto` persistido, aplica la alícuota `ivaPct` (o 0 si es exenta).
 */
export function importeCargoFactura(f: {
  importe: number;
  ivaMonto?: number | null;
  ivaPct?: number | null;
  facturarPorTramo?: boolean;
  tramos?: FacturaTramoCobro[];
}): number {
  if (f.ivaMonto != null && Number.isFinite(f.ivaMonto)) {
    return roundMoney2(f.importe + f.ivaMonto);
  }
  if (f.facturarPorTramo && f.tramos && f.tramos.length > 0) {
    return importeTotalConIvaPorTramo(f.importe, f.tramos, f.ivaPct);
  }
  const pct = Number(f.ivaPct);
  const iva = Number.isFinite(pct) && pct > 0 ? roundMoney2((f.importe * pct) / 100) : 0;
  return roundMoney2(f.importe + iva);
}

/** Estado del cargo según el cobro que muestra Facturas (`computeEstadoFacturaLectura`). */
export function estadoCargoFactura(cobrado: boolean, totalPagado: number): string {
  if (cobrado) return "cancelado";
  return totalPagado > 1e-6 ? "parcial" : "pendiente";
}
