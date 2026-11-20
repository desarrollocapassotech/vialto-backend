import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Número de comprobante interno (nov 2026): para ventas, compras, cobros, pagos, facturas y
 * liquidaciones que no tienen un comprobante externo propio. Lo pide el usuario con el tilde
 * "Comprobante interno"; el número lo asigna siempre el backend al guardar (nunca se
 * confía en el que muestra el front como vista previa).
 *
 * Una sola serie por empresa para todos los tipos, así un número interno no se repite en
 * ninguna cuenta. Formato: `INT-00000001`. El prefijo es lo que lo identifica como interno
 * (`esNumeroInterno`): no hay columna aparte.
 *
 * Sin constraint de base: dos altas simultáneas podrían tomar el mismo número (en facturas lo
 * frena `assertNumeroFacturaUnico`). Aceptado, mismo criterio que la unicidad de CUIT/DNI.
 */
export const PREFIJO_NUMERO_INTERNO = 'INT-';
const DIGITOS = 8;
const PATRON_SQL = '^INT-[0-9]+$';

export function formatNumeroInterno(n: number): string {
  return `${PREFIJO_NUMERO_INTERNO}${String(n).padStart(DIGITOS, '0')}`;
}

export function esNumeroInterno(numero: string | null | undefined): boolean {
  return /^INT-\d+$/.test(numero?.trim() ?? '');
}

/**
 * Orden de pago a proveedor (nov 2026): número correlativo por empresa con el formato
 * habitual de comprobante `0001-00000001`, que el sistema asigna al registrar un pago sin
 * número. Sigue la serie de los pagos a proveedores que ya tengan ese formato (si la empresa
 * venía cargando sus órdenes a mano, continúa desde la última). Mismo criterio sin
 * constraint de base que el número interno.
 */
export async function siguienteNumeroOrdenPago(
  db: Pick<PrismaClient, '$queryRaw'>,
  tenantId: string,
): Promise<string> {
  const rows = await db.$queryRaw<{ max: number | null }[]>(Prisma.sql`
    SELECT max(substr("numeroComprobante", 6)::bigint)::int AS max
      FROM "movimientos_cuenta_corriente"
      WHERE "tenantId" = ${tenantId}
        AND "tipo" = 'pago'
        AND "proveedorId" IS NOT NULL
        AND "numeroComprobante" ~ '^0001-[0-9]{8}$'`);
  return `0001-${String((rows[0]?.max ?? 0) + 1).padStart(8, '0')}`;
}

/** Siguiente número interno libre de la empresa (máximo usado + 1). */
export async function siguienteNumeroInterno(
  db: Pick<PrismaClient, '$queryRaw'>,
  tenantId: string,
): Promise<string> {
  // Las facturas y liquidaciones ya tienen su movimiento en Cuenta corriente con el mismo
  // número, pero se miran también sus tablas: una factura/liquidación eliminada deja el
  // movimiento anulado, y un tenant sin Cuenta corriente igual tiene que seguir la serie.
  const rows = await db.$queryRaw<{ max: number | null }[]>(Prisma.sql`
    SELECT max(n)::int AS max FROM (
      SELECT substr("numeroComprobante", 5)::bigint AS n
        FROM "movimientos_cuenta_corriente"
        WHERE "tenantId" = ${tenantId} AND "numeroComprobante" ~ ${PATRON_SQL}
      UNION ALL
      SELECT substr("numero", 5)::bigint
        FROM "facturas"
        WHERE "tenantId" = ${tenantId} AND "numero" ~ ${PATRON_SQL}
      UNION ALL
      SELECT substr("numeroComprobanteProveedor", 5)::bigint
        FROM "liquidaciones"
        WHERE "tenantId" = ${tenantId} AND "numeroComprobanteProveedor" ~ ${PATRON_SQL}
    ) t`);
  return formatNumeroInterno((rows[0]?.max ?? 0) + 1);
}
