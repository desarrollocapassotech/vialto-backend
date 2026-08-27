import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";

export type ViajeClienteDestinoItem = { etiqueta: string };
export type ViajeClienteProductoItem = {
  productoId: string;
  cantidad?: number | null;
  pesoKg?: number | null;
};

export type ViajeClienteItem = {
  clienteId: string;
  origen?: string | null;
  destinos: ViajeClienteDestinoItem[];
  productos: ViajeClienteProductoItem[];
  /** Igual que Viaje.cantidadFactura/precioUnitarioFactura: si ambos vienen, `monto` = cantidad × precioUnitario. */
  monto?: number | null;
  monedaMonto?: string | null;
  cantidad?: number | null;
  precioUnitario?: number | null;
};

/** Resuelve el monto de un cliente-tramo: cantidad×precioUnitario si ambos vienen, si no el monto cargado directo. */
function resolverMontoCliente(item: ViajeClienteItem): number | null {
  if (item.cantidad != null && item.precioUnitario != null) {
    return Math.round(item.cantidad * item.precioUnitario * 100) / 100;
  }
  return item.monto ?? null;
}

function normalizarDestinosCliente(
  raw: ViajeClienteDestinoItem[] | undefined | null,
): ViajeClienteDestinoItem[] {
  if (!raw?.length) return [];
  const out: ViajeClienteDestinoItem[] = [];
  for (const item of raw) {
    const etiqueta = String(item?.etiqueta ?? "").trim();
    if (!etiqueta) continue;
    out.push({ etiqueta });
  }
  return out;
}

function normalizarProductosCliente(
  raw: ViajeClienteProductoItem[] | undefined | null,
): ViajeClienteProductoItem[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: ViajeClienteProductoItem[] = [];
  for (const item of raw) {
    const productoId = String(item?.productoId ?? "").trim();
    if (!productoId || seen.has(productoId)) continue;
    seen.add(productoId);
    out.push({
      productoId,
      cantidad: item.cantidad ?? null,
      pesoKg: item.pesoKg ?? null,
    });
  }
  return out;
}

export function normalizarClientesDelViaje(
  raw:
    | Array<{
        clienteId: string;
        origen?: string | null;
        destinos?: ViajeClienteDestinoItem[] | null;
        productos?: ViajeClienteProductoItem[] | null;
        monto?: number | null;
        monedaMonto?: string | null;
        cantidad?: number | null;
        precioUnitario?: number | null;
      }>
    | undefined
    | null,
): ViajeClienteItem[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: ViajeClienteItem[] = [];
  for (const item of raw) {
    const clienteId = String(item?.clienteId ?? "").trim();
    if (!clienteId || seen.has(clienteId)) continue;
    seen.add(clienteId);
    out.push({
      clienteId,
      origen: item.origen?.trim() || null,
      destinos: normalizarDestinosCliente(item.destinos),
      productos: normalizarProductosCliente(item.productos),
      monto: item.monto ?? null,
      monedaMonto: item.monedaMonto?.trim() || "ARS",
      cantidad: item.cantidad ?? null,
      precioUnitario: item.precioUnitario ?? null,
    });
  }
  return out;
}

/** Suma de los montos de los clientes del viaje — espejo informativo para `Viaje.monto` (ver "monto total del viaje, dato secundario"). */
export function sumaMontosClientesDelViaje(
  items: ViajeClienteItem[],
): number | null {
  if (items.length === 0) return null;
  let suma = 0;
  let algunMonto = false;
  for (const item of items) {
    const monto = resolverMontoCliente(item);
    if (monto == null) continue;
    algunMonto = true;
    suma += monto;
  }
  return algunMonto ? Math.round(suma * 100) / 100 : null;
}

export async function assertClientesDelViaje(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  clienteIds: string[],
): Promise<void> {
  if (clienteIds.length === 0) return;
  const rows = await db.cliente.findMany({
    where: { tenantId, id: { in: clienteIds } },
    select: { id: true },
  });
  if (rows.length !== clienteIds.length) {
    throw new BadRequestException(
      "Algún cliente del viaje no existe o no pertenece a esta empresa.",
    );
  }
}

/** Valida que los productos cargados en los clientes del viaje existan, pertenezcan al tenant y estén activos. */
export async function assertProductosClientesDelViaje(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  items: ViajeClienteItem[],
): Promise<void> {
  const ids = [...new Set(items.flatMap((i) => i.productos.map((p) => p.productoId)))];
  if (ids.length === 0) return;
  const rows = await db.producto.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, activo: true },
  });
  if (rows.length !== ids.length) {
    throw new BadRequestException(
      "Algún producto de un cliente del viaje no existe o no pertenece a esta empresa.",
    );
  }
  if (rows.some((r) => !r.activo)) {
    throw new BadRequestException(
      "Ese producto está inactivo. Elegí otro o reactivalo desde Productos.",
    );
  }
}

export async function reemplazarClientesDelViaje(
  db: Prisma.TransactionClient,
  viajeId: string,
  items: ViajeClienteItem[],
  tenantId: string,
): Promise<void> {
  const actuales = await db.viajeCliente.findMany({
    where: { viajeId },
    select: { clienteId: true, facturacionEstado: true },
  });
  const bloqueados = actuales.filter(
    (r) => !["sin_facturar", "anulado"].includes(r.facturacionEstado),
  );
  if (bloqueados.length > 0) {
    throw new ConflictException(
      `No se puede modificar la lista de clientes del viaje: ${bloqueados
        .map((r) => r.clienteId)
        .join(", ")} ya tiene una factura o cobro vigente para su tramo.`,
    );
  }
  await db.viajeCliente.deleteMany({ where: { viajeId } });
  for (const [orden, item] of items.entries()) {
    const destinos = item.destinos;
    const ultimoDestino =
      destinos.length > 0 ? destinos[destinos.length - 1].etiqueta : null;
    const creado = await db.viajeCliente.create({
      data: {
        tenantId,
        viajeId,
        orden,
        clienteId: item.clienteId,
        origen: item.origen ?? null,
        destino: ultimoDestino,
        monto: resolverMontoCliente(item),
        monedaMonto: item.monedaMonto ?? "ARS",
        cantidad: item.cantidad ?? null,
        precioUnitario: item.precioUnitario ?? null,
      },
      select: { id: true },
    });
    if (destinos.length > 0) {
      await db.viajeClienteDestino.createMany({
        data: destinos.map((d, i) => ({
          tenantId,
          viajeClienteId: creado.id,
          orden: i,
          etiqueta: d.etiqueta,
        })),
      });
    }
    if (item.productos.length > 0) {
      await db.viajeClienteProducto.createMany({
        data: item.productos.map((p, i) => ({
          tenantId,
          viajeClienteId: creado.id,
          orden: i,
          productoId: p.productoId,
          cantidad: p.cantidad ?? null,
          pesoKg: p.pesoKg ?? null,
        })),
      });
    }
  }
}

export function idsClientesDelViaje(v: {
  clientesViaje?: Array<{ clienteId: string; orden: number }>;
}): string[] {
  return [...(v.clientesViaje ?? [])]
    .sort((a, b) => a.orden - b.orden)
    .map((x) => x.clienteId);
}

/** Include de clientes del viaje (multi-cliente, opcional), con sus destinos y productos propios. */
export const viajeClientesViajeInclude = {
  orderBy: { orden: "asc" as const },
  include: {
    cliente: { select: { id: true, nombre: true, condicionIva: true } },
    destinosCliente: { orderBy: { orden: "asc" as const } },
    productosCliente: {
      orderBy: { orden: "asc" as const },
      include: { producto: { select: { id: true, nombre: true, activo: true } } },
    },
  },
};
