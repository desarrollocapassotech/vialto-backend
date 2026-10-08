import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * De dónde viene cada fila de `CombustibleSyncErrorLog`. Solo `sincronizacion_offline`
 * (reportada por la app al fallar la cola offline) alimenta las Alertas del dashboard
 * de combustible; el resto lo registra el backend por su cuenta, para diagnosticar
 * reclamos de choferes ("la app no funciona"), y no se muestra al admin del tenant.
 */
export const ORIGENES_ERROR_CHOFER = [
  'sincronizacion_offline',
  'carga',
  'edicion_carga',
  'eliminacion_carga',
  'foto',
  'consulta',
  'login',
  'sesion',
] as const;
export type OrigenErrorChofer = (typeof ORIGENES_ERROR_CHOFER)[number];

/** Campos que nunca se guardan en el log, vengan donde vengan. */
const CAMPOS_SENSIBLES = new Set(['pin', 'password', 'token']);

/** Copia el body sin campos sensibles. No profundiza: los bodies de la app son planos. */
export function sanitizarBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!CAMPOS_SENSIBLES.has(k.toLowerCase())) limpio[k] = v;
  }
  return limpio;
}

const logger = new Logger('ChoferErrorLog');

/**
 * Guarda un error de la app de choferes en `CombustibleSyncErrorLog`. Best-effort:
 * nunca tira — si el log falla, solo queda en los logs del servidor, y el error
 * original le llega igual al chofer.
 */
export async function registrarErrorChofer(
  prisma: PrismaService,
  data: {
    tenantId: string;
    choferId: string | null;
    origen: OrigenErrorChofer;
    mensaje: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const patente =
      typeof data.payload['patente'] === 'string'
        ? data.payload['patente'].replace(/\s+/g, '').toUpperCase()
        : undefined;
    const vehiculo = patente
      ? await prisma.vehiculo.findFirst({
          where: { tenantId: data.tenantId, patente: { equals: patente, mode: 'insensitive' } },
          select: { id: true },
        })
      : null;

    await prisma.combustibleSyncErrorLog.create({
      data: {
        tenantId: data.tenantId,
        choferId: data.choferId,
        vehiculoId: vehiculo?.id ?? null,
        origen: data.origen,
        mensaje: data.mensaje.slice(0, 2000),
        payload: data.payload as object,
      },
    });
  } catch (error) {
    logger.error(
      `No se pudo registrar el error de chofer (${data.origen}, tenant ${data.tenantId}): ${data.mensaje}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
