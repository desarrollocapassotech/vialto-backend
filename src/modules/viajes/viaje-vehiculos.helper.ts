import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
export function normalizarVehiculoIds(
  raw: string[] | undefined | null,
): string[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    const s = String(id ?? "").trim();
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
    throw new BadRequestException(
      "Debés asignar al menos un vehículo al viaje.",
    );
  }
  const rows = await db.vehiculo.findMany({
    where: { tenantId, id: { in: vehiculoIds } },
    select: { id: true, transportistaId: true },
  });
  if (rows.length !== vehiculoIds.length) {
    throw new BadRequestException(
      "Algún vehículo no existe o no pertenece a esta empresa.",
    );
  }
  if (opts.requiereFlotaPropia) {
    const bad = rows.some((r) => !!r.transportistaId?.trim());
    if (bad) {
      throw new BadRequestException(
        "Solo se permiten vehículos de flota propia (sin transportista externo en su ficha).",
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

export async function reemplazarProductosDelViaje(
  db: Prisma.TransactionClient,
  viajeId: string,
  items: Array<{ productoId: string; cantidad?: number; pesoKg?: number }>,
  tenantId: string,
): Promise<void> {
  await db.viajeProducto.deleteMany({ where: { viajeId } });
  if (items.length === 0) return;
  await db.viajeProducto.createMany({
    data: items.map(({ productoId, cantidad, pesoKg }, orden) => ({
      tenantId,
      viajeId,
      productoId,
      orden,
      cantidad: cantidad ?? null,
      pesoKg: pesoKg ?? null,
    })),
  });
}

export function normalizarDestinosDelViaje(
  raw: Array<{ etiqueta: string }> | undefined | null,
): Array<{ etiqueta: string }> {
  if (!raw?.length) return [];
  const out: Array<{ etiqueta: string }> = [];
  for (const item of raw) {
    const etiqueta = String(item?.etiqueta ?? "").trim();
    if (!etiqueta) continue;
    out.push({ etiqueta });
  }
  return out;
}

/** Etiqueta del último destino (destino final de la ruta). */
export function ultimoDestinoEtiqueta(
  destinos: Array<{ etiqueta: string }>,
): string | null {
  return destinos.length > 0 ? destinos[destinos.length - 1].etiqueta : null;
}

export async function reemplazarDestinosDelViaje(
  db: Prisma.TransactionClient,
  viajeId: string,
  items: Array<{ etiqueta: string }>,
  tenantId: string,
): Promise<void> {
  await db.viajeDestino.deleteMany({ where: { viajeId } });
  if (items.length === 0) return;
  await db.viajeDestino.createMany({
    data: items.map(({ etiqueta }, orden) => ({
      tenantId,
      viajeId,
      orden,
      etiqueta,
    })),
  });
}

export function idsProductosDelViaje(v: {
  productosViaje: Array<{ productoId: string; orden: number }>;
}): string[] {
  return [...v.productosViaje]
    .sort((a, b) => a.orden - b.orden)
    .map((x) => x.productoId);
}

/** Args validados para el `include` de viajes con `vehiculosViaje` + `vehiculo` (exportado para que TS resuelva bien `ViajeGetPayload<typeof …>`). */

export const viajeConVehiculosViajeArgs =
  Prisma.validator<Prisma.ViajeDefaultArgs>()({
    include: {
      cliente: { select: { id: true, nombre: true } },
      chofer: {
        select: {
          id: true,
          nombre: true,
          dni: true,
          cuit: true,
          telefono: true,
          transportistaId: true,
        },
      },
      transportista: { select: { id: true, nombre: true } },
      transportistaEfectivo: { select: { id: true, nombre: true } },
      /** Número de factura en maestro (respaldo si `nroFactura` en viaje quedó vacío). */
      factura: { select: { id: true, numero: true } },
      liquidacionesViaje: { select: { liquidacionId: true } },
      productosViaje: {
        orderBy: { orden: "asc" },
        include: {
          producto: {
            select: { id: true, nombre: true, activo: true },
          },
        },
      },

      vehiculosViaje: {
        include: {
          vehiculo: true,
        },
      },
    },
  });

/** Include de destinos (hasta que `prisma generate` incorpore la relación en el cliente). */
export const viajeDestinosViajeInclude = {
  orderBy: { orden: "asc" as const },
  select: { id: true, orden: true, etiqueta: true, createdAt: true },
};

/**
 * Viaje cargado con `vehiculosViaje` (cada fila incluye `vehiculo`).
 * Usar `Prisma.validator` + `typeof` para que `ViajeGetPayload` infiera bien (evita `vehiculosViaje: never[]` con un objeto literal suelto).
 */
export type ViajeConVehiculosViaje = Prisma.ViajeGetPayload<
  typeof viajeConVehiculosViajeArgs
> & {
  destinosViaje?: Array<{
    id: string;
    orden: number;
    etiqueta: string;
    createdAt: Date;
  }>;
};

/** Incluido en consultas de viaje que deben exponer `vehiculosViaje`. */
export const VIAJE_INCLUDE_VEHICULOS = viajeConVehiculosViajeArgs.include!;

/** Para `include:` si el análisis TS del IDE no reconoce aún la relación `vehiculosViaje` / `destinosViaje`. */
export const VIAJE_INCLUDE_VEHICULOS_INCLUDE = {
  ...VIAJE_INCLUDE_VEHICULOS,
  destinosViaje: viajeDestinosViajeInclude,
} as any;

/** IDs de vehículo en orden del viaje (helper para no depender de la expansión de `ViajeGetPayload` en otros archivos). */
export function idsVehiculosDelViaje(v: ViajeConVehiculosViaje): string[] {
  return v.vehiculosViaje.map((x) => x.vehiculoId);
}
