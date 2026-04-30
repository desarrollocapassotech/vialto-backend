import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

export function normalizarVehiculoIds(raw: string[] | undefined | null): string[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    const s = String(id ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export async function assertVehiculosDelViaje(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  vehiculoIds: string[],
  opts: { requiereFlotaPropia: boolean },
): Promise<void> {
  if (vehiculoIds.length === 0) {
    throw new BadRequestException('Debés asignar al menos un vehículo al viaje.');
  }
  const rows = await db.vehiculo.findMany({
    where: { tenantId, id: { in: vehiculoIds } },
    select: { id: true, transportistaId: true },
  });
  if (rows.length !== vehiculoIds.length) {
    throw new BadRequestException('Algún vehículo no existe o no pertenece a esta empresa.');
  }
  if (opts.requiereFlotaPropia) {
    const bad = rows.some((r) => !!r.transportistaId?.trim());
    if (bad) {
      throw new BadRequestException(
        'Solo se permiten vehículos de flota propia (sin transportista externo en su ficha).',
      );
    }
  }
}

export async function reemplazarVehiculosDelViaje(
  db: Prisma.TransactionClient,
  viajeId: string,
  vehiculoIds: string[],
  tenantId: string,
): Promise<void> {
  await db.viajeVehiculo.deleteMany({ where: { viajeId } });
  if (vehiculoIds.length === 0) return;
  await db.viajeVehiculo.createMany({
    data: vehiculoIds.map((vehiculoId, orden) => ({
      tenantId,
      viajeId,
      vehiculoId,
      orden,
    })),
  });
}

export async function reemplazarCargasDelViaje(
  db: Prisma.TransactionClient,
  viajeId: string,
  cargaIds: string[],
  tenantId: string,
): Promise<void> {
  await db.viajeCarga.deleteMany({ where: { viajeId } });
  if (cargaIds.length === 0) return;
  await db.viajeCarga.createMany({
    data: cargaIds.map((cargaId, orden) => ({
      tenantId,
      viajeId,
      cargaId,
      orden,
    })),
  });
}

export function idsCargasDelViaje(v: {
  cargasViaje: Array<{ cargaId: string; orden: number }>;
}): string[] {
  return [...v.cargasViaje].sort((a, b) => a.orden - b.orden).map((x) => x.cargaId);
}

/** Args validados para el `include` de viajes con `vehiculosViaje` + `vehiculo` (exportado para que TS resuelva bien `ViajeGetPayload<typeof …>`). */
export const viajeConVehiculosViajeArgs = Prisma.validator<Prisma.ViajeDefaultArgs>()({
  include: {
    cliente: { select: { id: true, nombre: true } },
    transportista: { select: { id: true, nombre: true } },
    /** Número de factura en maestro (respaldo si `nroFactura` en viaje quedó vacío). */
    factura: { select: { id: true, numero: true } },
    cargasViaje: {
      orderBy: { orden: 'asc' },
      include: {
        carga: {
          select: { id: true, nombre: true, activo: true, unidadMedida: true },
        },
      },
    },
    vehiculosViaje: {
      orderBy: { orden: 'asc' },
      include: {
        vehiculo: { select: { id: true, patente: true, tipo: true } },
      },
    },
  },
});

/**
 * Viaje cargado con `vehiculosViaje` (cada fila incluye `vehiculo`).
 * Usar `Prisma.validator` + `typeof` para que `ViajeGetPayload` infiera bien (evita `vehiculosViaje: never[]` con un objeto literal suelto).
 */
export type ViajeConVehiculosViaje = Prisma.ViajeGetPayload<typeof viajeConVehiculosViajeArgs>;

/** Incluido en consultas de viaje que deben exponer `vehiculosViaje`. */
export const VIAJE_INCLUDE_VEHICULOS = viajeConVehiculosViajeArgs.include!;

/** Para `include:` si el análisis TS del IDE no reconoce aún la relación `vehiculosViaje`. */
export const VIAJE_INCLUDE_VEHICULOS_INCLUDE = VIAJE_INCLUDE_VEHICULOS as any;

/** IDs de vehículo en orden del viaje (helper para no depender de la expansión de `ViajeGetPayload` en otros archivos). */
export function idsVehiculosDelViaje(v: ViajeConVehiculosViaje): string[] {
  return v.vehiculosViaje.map((x) => x.vehiculoId);
}
