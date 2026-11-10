import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Forma en que se guarda un ID fiscal (CUIT, RUT, RUC, CNPJ…) o el CUIT de un chofer:
 * solo letras y dígitos, en mayúscula — "30-67863361-1" → "30678633611",
 * "12.345.678-k" → "12345678K". Los guiones/puntos se agregan solo al mostrar
 * (`formatIdFiscal` del front). Así dos cargas del mismo CUIT con distinto formato
 * se reconocen como el mismo y no generan duplicados. null si no queda nada.
 */
export function normalizarIdFiscal(valor: string | null | undefined): string | null {
  const v = (valor ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return v || null;
}

/**
 * Clave de persona de un chofer para detectar duplicados: el DNI (sin separadores ni
 * ceros a la izquierda); si no tiene DNI, el que está dentro del CUIT/CUIL (dígitos
 * 3 a 10). Así "Suarez Carlos" con CUIT 20-12261362-4 y "Suárez Carlos Alberto" con
 * DNI 12.261.362 son el mismo chofer.
 */
export function claveDniChofer(
  dni: string | null | undefined,
  cuit: string | null | undefined,
): string | null {
  const d = normalizarIdFiscal(dni) ?? '';
  const c = normalizarIdFiscal(cuit) ?? '';
  let clave = '';
  if (/^\d{11}$/.test(d)) clave = d.slice(2, 10);
  else if (d) clave = d;
  else if (/^\d{11}$/.test(c)) clave = c.slice(2, 10);
  return clave.replace(/^0+/, '') || null;
}

/**
 * Todas las claves de documento de un chofer (la del DNI y la del CUIT, sin
 * repetidos). Si un chofer tiene DNI cargado y además se le carga un CUIT con
 * otro número, se evalúan ambos para que ninguno pueda chocar con otro chofer.
 */
export function clavesDniChofer(
  dni: string | null | undefined,
  cuit: string | null | undefined,
): string[] {
  const claves = [
    claveDniChofer(dni, null),
    claveDniChofer(null, cuit),
  ].filter((c): c is string => Boolean(c));
  return [...new Set(claves)];
}

const CLAVE_SOLO_DNI_CHOFER_SQL = Prisma.sql`
  ltrim(CASE
    WHEN upper(regexp_replace(coalesce(dni, ''), '[^0-9A-Za-z]', '', 'g')) ~ '^[0-9]{11}$'
      THEN substr(upper(regexp_replace(dni, '[^0-9A-Za-z]', '', 'g')), 3, 8)
    WHEN upper(regexp_replace(coalesce(dni, ''), '[^0-9A-Za-z]', '', 'g')) <> ''
      THEN upper(regexp_replace(dni, '[^0-9A-Za-z]', '', 'g'))
  END, '0')`;

const CLAVE_SOLO_CUIT_CHOFER_SQL = Prisma.sql`
  ltrim(CASE
    WHEN regexp_replace(coalesce(cuit, ''), '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
      THEN substr(regexp_replace(cuit, '[^0-9]', '', 'g'), 3, 8)
  END, '0')`;

/** Otro chofer del tenant que es la misma persona (mismo DNI, directo o dentro del CUIT). */
export async function buscarChoferMismoDocumento(
  db: Pick<PrismaClient, '$queryRaw'>,
  tenantId: string,
  dni: string | null | undefined,
  cuit: string | null | undefined,
  excludeId?: string,
): Promise<{ id: string; nombre: string } | null> {
  const claves = clavesDniChofer(dni, cuit);
  if (claves.length === 0) return null;
  const lista = Prisma.join(claves);
  const rows = await db.$queryRaw<{ id: string; nombre: string }[]>(Prisma.sql`
    SELECT id, nombre FROM "choferes"
    WHERE "tenantId" = ${tenantId}
      AND id <> ${excludeId ?? ''}
      AND (
        ${CLAVE_SOLO_DNI_CHOFER_SQL} IN (${lista})
        OR ${CLAVE_SOLO_CUIT_CHOFER_SQL} IN (${lista})
      )
    LIMIT 1`);
  return rows[0] ?? null;
}
