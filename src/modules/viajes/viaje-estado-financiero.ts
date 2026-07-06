import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Alinea el estado del viaje con los comprobantes emitidos (factura cliente y/o liquidación transportista).
 * Viajes con transportista externo requieren ambos antes de pasar a `facturado_sin_cobrar`.
 */
export async function syncViajeEstadoTrasComprobante(
  tx: Tx,
  tenantId: string,
  viajeId: string,
): Promise<void> {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    select: {
      id: true,
      estado: true,
      transportistaId: true,
      facturaId: true,
      liquidacionesViaje: { select: { id: true } },
    },
  });
  if (!viaje) return;

  const estado = viaje.estado;
  if (estado === 'cancelado' || estado === 'cobrado') return;

  const requiereDual = Boolean(viaje.transportistaId?.trim());
  const tieneFactura = Boolean(viaje.facturaId);
  const tieneLiquidacion = viaje.liquidacionesViaje.length > 0;
  const cicloCompleto = requiereDual ? tieneFactura && tieneLiquidacion : tieneFactura;

  if (cicloCompleto) {
    if (estado !== 'facturado_sin_cobrar') {
      await tx.viaje.update({
        where: { id: viajeId },
        data: { estado: 'facturado_sin_cobrar' },
      });
    }
    return;
  }

  if (requiereDual && estado === 'facturado_sin_cobrar') {
    await tx.viaje.update({
      where: { id: viajeId },
      data: { estado: 'finalizado_sin_facturar' },
    });
  }
}

export async function syncViajesEstadoTrasComprobante(
  tx: Tx,
  tenantId: string,
  viajeIds: string[],
): Promise<void> {
  for (const id of viajeIds) {
    await syncViajeEstadoTrasComprobante(tx, tenantId, id);
  }
}
