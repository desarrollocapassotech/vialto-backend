import type { ConceptoFacturable } from './arca-cvlp.util';
import { round2 } from './arca-iva.util';
import type { ArcaComprobanteItem } from './types/arca.types';

/**
 * Auditoría IVA (nov 2026, H3): la nota de crédito que anula una factura tiene que
 * llevar los mismos renglones que se autorizaron, no rearmarse desde los viajes
 * (eso perdía tramos, alícuotas por línea, ediciones y clientes secundarios).
 * Los renglones salen del `auditMetadata` del pedido autorizado (`ArcaLog` cuyo CAE
 * es el de la factura). Devuelve null si no hay renglones (facturas muy viejas).
 */
export function conceptosNotaCreditoDesdeAutorizado(
  metadata: { items?: unknown } | null | undefined,
): ConceptoFacturable[] | null {
  const items = Array.isArray(metadata?.items)
    ? (metadata.items as ArcaComprobanteItem[])
    : [];
  const conceptos = items
    .filter((i) => Number.isFinite(i?.importeBase) && i.importeBase !== 0)
    .map((i) => ({
      producto: i.producto,
      descripcion: String(i.descripcion ?? '').trim() || 'Servicios de transporte',
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      importe: round2(i.importeBase),
      ivaPct: i.ivaPct,
    }));
  return conceptos.length > 0 ? conceptos : null;
}

/**
 * La anulación total tiene que igualar neto, IVA y total de la factura. Devuelve el
 * mensaje de error para el usuario, o null si coincide.
 */
export function diferenciaNotaCreditoFactura(
  nc: { impNeto: number; impIva: number; impTotal: number },
  factura: { impNeto: number; impIva: number },
): string | null {
  const facturaTotal = round2(factura.impNeto + factura.impIva);
  if (
    round2(nc.impNeto) === round2(factura.impNeto) &&
    round2(nc.impIva) === round2(factura.impIva) &&
    round2(nc.impTotal) === facturaTotal
  ) {
    return null;
  }
  const $ = (n: number) =>
    `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    'No se emitió la nota de crédito: no coincide con la factura que anula. ' +
    `Factura: neto ${$(factura.impNeto)}, IVA ${$(factura.impIva)}, total ${$(facturaTotal)}. ` +
    `Nota de crédito: neto ${$(nc.impNeto)}, IVA ${$(nc.impIva)}, total ${$(nc.impTotal)}. ` +
    'Consultá con soporte.'
  );
}
