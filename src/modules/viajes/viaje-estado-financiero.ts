import type { Prisma } from '@prisma/client';
import type { ViajeFacturacionEstado, ViajeLiquidacionEstado } from './viaje-estados';

type Tx = Prisma.TransactionClient;

/**
 * Mapea el `arcaEstado` de la factura vinculada al indicador de facturación del viaje.
 * `tieneArca` distingue el `arcaEstado === null` de un tenant sin integración (factura
 * manual → cuenta como facturada de una) del de un tenant CON integración cuya factura
 * todavía no se emitió a AFIP (sigue "sin facturar" hasta el primer intento de emisión).
 */
export function mapFacturacionEstado(
  factura: { arcaEstado: string | null } | null,
  cobrado: boolean,
  tieneArca: boolean,
): ViajeFacturacionEstado {
  if (!factura) return 'sin_facturar';
  if (factura.arcaEstado === 'pendiente_cae') return 'esperando_afip';
  if (factura.arcaEstado === 'error') return 'error_afip';
  if (factura.arcaEstado === 'anulado') return 'anulado';
  if (factura.arcaEstado == null && tieneArca) return 'sin_facturar';
  return cobrado ? 'cobrado' : 'facturado';
}

/** Mapea el `estado` de una liquidación al indicador de liquidación del viaje. */
export function mapLiquidacionEstado(estado: string | null): ViajeLiquidacionEstado {
  if (estado === 'borrador' || estado === 'pendiente_cae') return 'esperando_afip';
  if (estado === 'autorizado') return 'liquidado';
  if (estado === 'error') return 'error_afip';
  if (estado === 'anulado') return 'anulado';
  return 'sin_liquidar';
}

/**
 * Recalcula `facturacionEstado` de un viaje a partir de la factura vinculada
 * (via `facturaId`) y si ya se registró cobro completo. Una factura anulada
 * dejar de "contar" automáticamente: el indicador pasa a `anulado`, que —
 * junto con `sin_facturar` — deja al viaje disponible para re-facturar.
 */
export async function syncFacturacionEstadoViaje(
  tx: Tx,
  tenantId: string,
  viajeId: string,
  opts: { cobrado?: boolean } = {},
): Promise<void> {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    select: {
      id: true,
      etapa: true,
      facturacionEstado: true,
      facturaId: true,
      factura: { select: { arcaEstado: true } },
      tenant: { select: { modules: true } },
    },
  });
  if (!viaje) return;

  const tieneArca = viaje.tenant.modules.includes('integracion-arca');
  const cobrado =
    opts.cobrado ?? viaje.facturacionEstado === 'cobrado';
  const next = mapFacturacionEstado(viaje.factura, cobrado, tieneArca);
  if (next !== viaje.facturacionEstado) {
    await tx.viaje.update({
      where: { id: viajeId },
      data: { facturacionEstado: next },
    });
  }
}

export async function syncFacturacionEstadoViajes(
  tx: Tx,
  tenantId: string,
  viajeIds: string[],
  opts: { cobrado?: boolean } = {},
): Promise<void> {
  for (const id of viajeIds) {
    await syncFacturacionEstadoViaje(tx, tenantId, id, opts);
  }
}

/**
 * Recalcula `liquidacionEstado` de un viaje a partir de la liquidación activa
 * más reciente vinculada (`LiquidacionViaje`). Ignora liquidaciones anuladas
 * salvo que sea la única existente (para poder mostrar "Anulado" en vez de
 * "Sin liquidar" cuando corresponde). `null` si el viaje no tiene transportista
 * externo — el tenant sin integración ARCA simplemente nunca genera filas acá.
 */
export async function syncLiquidacionEstadoViaje(
  tx: Tx,
  tenantId: string,
  viajeId: string,
): Promise<void> {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    select: {
      id: true,
      transportistaId: true,
      liquidacionEstado: true,
      liquidacionesViaje: {
        select: { liquidacion: { select: { estado: true, updatedAt: true } } },
      },
    },
  });
  if (!viaje) return;

  if (!viaje.transportistaId?.trim()) {
    if (viaje.liquidacionEstado !== null) {
      await tx.viaje.update({ where: { id: viajeId }, data: { liquidacionEstado: null } });
    }
    return;
  }

  const activa = viaje.liquidacionesViaje
    .map((lv) => lv.liquidacion)
    .filter((l) => l.estado !== 'anulado')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  const masReciente = viaje.liquidacionesViaje
    .map((lv) => lv.liquidacion)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  const elegida = activa ?? masReciente;
  const next = mapLiquidacionEstado(elegida?.estado ?? null);
  if (next !== viaje.liquidacionEstado) {
    await tx.viaje.update({ where: { id: viajeId }, data: { liquidacionEstado: next } });
  }
}

export async function syncLiquidacionEstadoViajes(
  tx: Tx,
  tenantId: string,
  viajeIds: string[],
): Promise<void> {
  for (const id of viajeIds) {
    await syncLiquidacionEstadoViaje(tx, tenantId, id);
  }
}
