import type { Prisma } from '@prisma/client';
import type { ViajeFacturacionEstado, ViajeLiquidacionEstado } from './viaje-estados';

type Tx = Prisma.TransactionClient;

/**
 * Mapea el `arcaEstado` de la factura vinculada al indicador de facturación del viaje.
 * Tenant sin integración ARCA: se ignora `arcaEstado` por completo (no debería tener
 * ninguno seteado en operación normal, pero si quedó algo de datos de prueba o el
 * módulo se desactivó después, no debe filtrarse ningún estado de AFIP) — el indicador
 * queda simple (sin_facturar/facturado/cobrado). Tenant con ARCA: `arcaEstado === null`
 * significa que la factura todavía no se emitió (sigue "sin facturar" hasta el primer
 * intento de emisión).
 */
export function mapFacturacionEstado(
  factura: { arcaEstado: string | null } | null,
  cobrado: boolean,
  tieneArca: boolean,
): ViajeFacturacionEstado {
  if (!factura) return 'sin_facturar';
  if (tieneArca) {
    if (factura.arcaEstado === 'pendiente_cae') return 'esperando_afip';
    if (factura.arcaEstado === 'error') return 'error_afip';
    if (factura.arcaEstado === 'anulado') return 'anulado';
    if (factura.arcaEstado == null) return 'sin_facturar';
  }
  return cobrado ? 'cobrado' : 'facturado';
}

/**
 * Mapea el `estado` de una liquidación al indicador de liquidación del viaje.
 * Tenant sin integración ARCA: la liquidación es un registro manual (nunca pasa por
 * `pendiente_cae`/`autorizado`/`error` — queda en `borrador` para siempre, ver
 * `CrearLiquidacionManualModal` con `hasArca=false`), así que un `borrador` ahí
 * significa "ya se cargó", no "esperando AFIP". Tenant con ARCA: se usa el ciclo de
 * vida completo del comprobante.
 */
export function mapLiquidacionEstado(
  estado: string | null,
  tieneArca: boolean,
): ViajeLiquidacionEstado {
  if (estado == null) return 'sin_liquidar';
  if (estado === 'anulado') return 'anulado';
  if (!tieneArca) return 'liquidado';
  if (estado === 'borrador' || estado === 'pendiente_cae') return 'esperando_afip';
  if (estado === 'autorizado') return 'liquidado';
  if (estado === 'error') return 'error_afip';
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

  const tieneArca = viaje.tenant.modules.includes('emision-facturas-arca');
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
 * "Sin liquidar" cuando corresponde). `null` solo si el viaje no tiene
 * transportista externo — eso sí es "no aplica" independientemente de ARCA.
 * Tenants sin `emision-liquido-producto-arca` SÍ pueden tener liquidaciones reales (registro
 * manual vía `CrearLiquidacionManualModal` con `hasArca=false`), así que no hay
 * que nulear el indicador para ellos — `mapLiquidacionEstado` ya se encarga de
 * no exponer sub-estados de AFIP cuando `tieneArca` es falso.
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
      tenant: { select: { modules: true } },
    },
  });
  if (!viaje) return;

  if (!viaje.transportistaId?.trim()) {
    if (viaje.liquidacionEstado !== null) {
      await tx.viaje.update({ where: { id: viajeId }, data: { liquidacionEstado: null } });
    }
    return;
  }

  const tieneArca = viaje.tenant.modules.includes('emision-liquido-producto-arca');
  const activa = viaje.liquidacionesViaje
    .map((lv) => lv.liquidacion)
    .filter((l) => l.estado !== 'anulado')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  const masReciente = viaje.liquidacionesViaje
    .map((lv) => lv.liquidacion)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  const elegida = activa ?? masReciente;
  const next = mapLiquidacionEstado(elegida?.estado ?? null, tieneArca);
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
