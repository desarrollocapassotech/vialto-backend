import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ViajesAutoEstadoService } from "./viajes-auto-estado.service";
import { CreateViajeDto } from "./dto/create-viaje.dto";
import { AddGastoDto } from "./dto/add-gasto.dto";
import { AddPagoTransportistaDto } from "./dto/add-pago-transportista.dto";
import { generateNumeroViaje } from "./generate-viaje-numero";
import {
  assertTransportistaEfectivoSubcontratacion,
  mergeViajeOperacionIds,
  resolveContratanteRealizaFlete,
  resolveTransportistaEfectivoIdPersist,
} from "./viaje-operacion-exclusiva";
import {
  assertVehiculosDelViaje,
  idsProductosDelViaje,
  normalizarDestinosDelViaje,
  reemplazarDestinosDelViaje,
  reemplazarProductosDelViaje,
  reemplazarVehiculosDelViaje,
  ultimoDestinoEtiqueta,
  viajeDestinosViajeInclude,
  VIAJE_INCLUDE_VEHICULOS_INCLUDE,
  type ViajeConVehiculosViaje,
} from "./viaje-vehiculos.helper";
import { UpdateViajeDto } from "./dto/update-viaje.dto";
import { ViajesPaginatedQueryDto } from "./dto/viajes-paginated-query.dto";
import {
  VIAJE_ESTADOS_SET,
  esEstadoViajeFinal,
  normalizarEstadoViaje,
  type ViajeEstado,
} from "./viaje-estados";
import {
  buildViajeExportacionesResponse,
  enrichViajeConExportaciones,
} from "./viaje-exportaciones.util";
import {
  GananciaBrutaValidationError,
  buildGananciaBrutaResumen,
  enrichViajeConGananciaBruta,
  gananciaBrutaValorOrdenable,
  resolveGananciaBrutaPersist,
} from "./viaje-ganancia-bruta.util";
import {
  buildViajesPaginatedWhere,
  buildViajesPrismaOrderBy,
  compareViajesFechaAr,
  compareViajesOrdenNullable,
  resolveViajesSort,
  type ViajesSortDir,
} from "./viajes-paginated-query.util";

/** Transacciones con varios writes + Neon pueden superar el default de 5s de Prisma. */
const VIAJE_INTERACTIVE_TX = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * Añadimos las liquidaciones y facturas al include base para que el frontend
 * y las validaciones cuenten siempre con el monto real de los comprobantes.
 */
const VIAJE_INCLUDE_FULL = {
  ...VIAJE_INCLUDE_VEHICULOS_INCLUDE,
  factura: {
    select: {
      id: true,
      numero: true,
      importe: true,
      moneda: true,
      estado: true,
      arcaEstado: true,
      viajes: { select: { id: true, monto: true } },
    },
  },
  liquidacionesViaje: {
    include: {
      liquidacion: {
        include: {
          conceptosLineas: true,
          viajes: true,
        },
      },
    },
  },
};

/**
 * Calcula el monto prorrateado que le corresponde a un viaje a partir
 * de las facturas/liquidaciones emitidas.
 */
function calcularMontosReales<
  T extends {
    monto?: number | null;
    precioTransportistaExterno?: number | null;
    factura?: any;
    liquidacionesViaje?: any;
  },
>(viaje: T) {
  let montoFacturadoReal = null;
  let monedaMontoFacturadoReal = null;
  let costoLiquidadoReal = null;
  let monedaCostoLiquidadoReal = null;

  // Prorrateo de Factura al cliente (aplica si no está anulada ni con error ARCA)
  if (
    viaje.factura &&
    typeof viaje.factura.importe === "number" &&
    viaje.factura.estado !== "anulada" &&
    viaje.factura.arcaEstado !== "error"
  ) {
    const totalEstimado =
      viaje.factura.viajes?.reduce(
        (acc: number, v: any) =>
          acc + (typeof v.monto === "number" ? v.monto : 0),
        0,
      ) || 0;

    if (totalEstimado > 0 && typeof viaje.monto === "number") {
      montoFacturadoReal =
        viaje.factura.importe * (viaje.monto / totalEstimado);
    } else {
      const cant = viaje.factura.viajes?.length || 1;
      montoFacturadoReal = viaje.factura.importe / cant;
    }
    monedaMontoFacturadoReal = viaje.factura.moneda;
  }

  // Prorrateo de Liquidación CVLP
  const liqViaje = viaje.liquidacionesViaje?.find(
    (lv: any) =>
      lv.liquidacion?.estado !== "anulado" &&
      lv.liquidacion?.estado !== "error",
  );
  if (liqViaje?.liquidacion) {
    const liq = liqViaje.liquidacion;
    if (liq.bruto > 0 && typeof liqViaje.subtotal === "number") {
      costoLiquidadoReal = liq.liquido * (liqViaje.subtotal / liq.bruto);
    } else {
      costoLiquidadoReal = liq.liquido / (liq.cantViajes || 1);
    }
    monedaCostoLiquidadoReal = "ARS";
  }

  return {
    ...viaje,
    montoFacturadoReal,
    monedaMontoFacturadoReal,
    costoLiquidadoReal,
    monedaCostoLiquidadoReal,
  };
}

type ProductoItem = { productoId: string; cantidad?: number; pesoKg?: number };
type PagoTransportistaInput = { monto?: unknown; moneda?: unknown };
type DestinoItem = { etiqueta: string };

function resolveDestinosParaCreate(dto: CreateViajeDto): DestinoItem[] {
  const fromArray = normalizarDestinosDelViaje(dto.destinos);
  if (fromArray.length > 0) return fromArray;
  const legacy = dto.destino?.trim();
  if (legacy) return [{ etiqueta: legacy }];
  throw new BadRequestException("Ingresá al menos un destino.");
}

function resolveDestinosParaUpdate(
  dto: UpdateViajeDto,
): DestinoItem[] | undefined {
  if (dto.destinos !== undefined) {
    const norm = normalizarDestinosDelViaje(dto.destinos);
    if (norm.length === 0) {
      throw new BadRequestException("Ingresá al menos un destino.");
    }
    return norm;
  }
  if (dto.destino !== undefined) {
    const legacy = dto.destino?.trim();
    if (!legacy) {
      throw new BadRequestException("El destino no puede estar vacío.");
    }
    return [{ etiqueta: legacy }];
  }
  return undefined;
}

function normalizarProductoItems(
  raw: ProductoItem[] | undefined | null,
): ProductoItem[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: ProductoItem[] = [];
  for (const item of raw) {
    const id = String(item.productoId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ productoId: id, cantidad: item.cantidad, pesoKg: item.pesoKg });
  }
  return out;
}

async function assertProductosAsignables(
  prisma: PrismaService,
  tenantId: string,
  items: ProductoItem[],
  opts: { modo: "create" | "update"; currentProductoIds?: ReadonlySet<string> },
): Promise<void> {
  if (items.length === 0) return;
  const ids = items.map((i) => i.productoId);
  const rows = await prisma.producto.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, activo: true },
  });
  if (rows.length !== ids.length) {
    throw new BadRequestException(
      "Algún producto no existe o no pertenece a esta empresa.",
    );
  }
  const current = opts.currentProductoIds ?? new Set<string>();
  for (const row of rows) {
    if (!row.activo) {
      const conserva = opts.modo === "update" && current.has(row.id);
      if (opts.modo === "create" || !conserva) {
        throw new BadRequestException(
          "Ese producto está inactivo. Elegí otro o reactivalo desde Productos.",
        );
      }
    }
  }
}

function assertFechaDescargaValida(
  fechaCarga: Date,
  fechaDescarga: Date,
): void {
  const fc = new Date(fechaCarga.toISOString().slice(0, 10));
  const fd = new Date(fechaDescarga.toISOString().slice(0, 10));
  if (fd < fc) {
    throw new BadRequestException(
      "La fecha de descarga no puede ser anterior a la fecha de carga.",
    );
  }
}

@Injectable()
export class ViajesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoEstado: ViajesAutoEstadoService,
  ) {}

  /** Acepta legado `finalizado` y valida contra {@link VIAJE_ESTADOS}. */
  private parseEstadoViaje(estado: string): ViajeEstado {
    const n = normalizarEstadoViaje(estado);
    if (!VIAJE_ESTADOS_SET.has(n)) {
      throw new BadRequestException("Estado de viaje inválido");
    }
    return n as ViajeEstado;
  }

  /**
   * Obtiene el monto real acordado sumando las liquidaciones emitidas,
   * prorrateando los conceptos según si son del viaje puntual o generales.
   */
  private calcularAcordado(v: {
    id?: string;
    precioTransportistaExterno?: number | null;
    liquidacionesViaje?: any[];
  }): number {
    let acordado = v.precioTransportistaExterno ?? 0;

    if (v.liquidacionesViaje && v.liquidacionesViaje.length > 0) {
      let montoReal = 0;
      let tieneMontoReal = false;

      for (const lv of v.liquidacionesViaje) {
        const liq = lv.liquidacion;
        // Ignoramos anuladas o fallidas
        if (liq && (liq.estado === "anulado" || liq.estado === "error"))
          continue;

        // Cálculo contemplando conceptos asignados al viaje o generales divididos
        if (liq && Array.isArray(liq.conceptosLineas) && v.id) {
          const brutoViaje =
            typeof lv.monto === "number"
              ? lv.monto
              : Number(v.precioTransportistaExterno) || 0;
          const comisionPct = Number(liq.comisionPct) || 0;
          const comisionMonto = (brutoViaje * comisionPct) / 100;

          const divisor =
            typeof liq.cantViajes === "number" && liq.cantViajes > 0
              ? liq.cantViajes
              : Array.isArray(liq.viajes) && liq.viajes.length > 0
                ? liq.viajes.length
                : 1;

          const efectoConceptos = liq.conceptosLineas.reduce(
            (sum: number, c: any) => {
              const monto = Number(c.monto) || 0;
              if (!monto) return sum;
              const conSigno = c.signo === "contra" ? -monto : monto;

              // 1. Asignado específicamente a ESTE viaje (100%)
              if (c.viajeId && String(c.viajeId) === String(v.id)) {
                return sum + conSigno;
              }
              // 2. Asignado a OTRO viaje (0%)
              if (c.viajeId != null && String(c.viajeId).trim() !== "") {
                return sum;
              }
              // 3. General (viajeId == null/empty) -> se divide en el total de viajes
              return sum + conSigno / divisor;
            },
            0,
          );

          const netoGravado = brutoViaje - comisionMonto + efectoConceptos;
          const ivaPct = Number(liq.ivaPct) || 0;
          const ivaMonto = (netoGravado * ivaPct) / 100;

          montoReal += netoGravado + ivaMonto;
          tieneMontoReal = true;
        } else if (lv.monto != null) {
          montoReal += Number(lv.monto);
          tieneMontoReal = true;
        } else if (liq?.liquido != null) {
          montoReal += Number(liq.liquido);
          tieneMontoReal = true;
        }
      }

      if (tieneMontoReal) {
        acordado = montoReal;
      }
    }

    return acordado;
  }

  private applyGananciaBrutaFields(
    viaje: {
      monto?: number | null;
      monedaMonto?: string | null;
      monedaPrecioTransportistaExterno?: string | null;
      otrosGastos?: unknown;
    },
    dto: {
      gananciaBrutaManual?: number | null;
      monedaGananciaBrutaManual?: string | null;
      monedaMonto?: string;
      monedaPrecioTransportistaExterno?: string;
      otrosGastos?: unknown;
    },
    existing?: {
      gananciaBrutaManual?: number | null;
      monedaGananciaBrutaManual?: string | null;
    },
  ): {
    gananciaBrutaManual: number | null;
    monedaGananciaBrutaManual: string | null;
  } {
    try {
      return resolveGananciaBrutaPersist(
        {
          monto: viaje.monto,
          monedaMonto: dto.monedaMonto ?? viaje.monedaMonto,
          monedaPrecioTransportistaExterno:
            dto.monedaPrecioTransportistaExterno ??
            viaje.monedaPrecioTransportistaExterno,
          otrosGastos:
            dto.otrosGastos !== undefined ? dto.otrosGastos : viaje.otrosGastos,
        },
        {
          gananciaBrutaManual: dto.gananciaBrutaManual,
          monedaGananciaBrutaManual: dto.monedaGananciaBrutaManual,
        },
        existing,
      );
    } catch (e) {
      if (e instanceof GananciaBrutaValidationError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  private getMontoFinal(viaje: {
    monto: number | null;
    monedaMonto?: string | null;
    otrosGastos?: unknown;
  }) {
    const monto = viaje.monto;
    if (monto == null || monto <= 0) {
      throw new BadRequestException(
        "Para finalizar un viaje se requiere un monto mayor a 0",
      );
    }
    // Sumar otrosGastos en la misma moneda que monto
    const moneda = (viaje.monedaMonto ?? "ARS") === "USD" ? "USD" : "ARS";
    const gastos = Array.isArray(viaje.otrosGastos)
      ? (viaje.otrosGastos as Array<{ monto?: number; moneda?: string }>)
      : [];
    const extraMismaMmoneda = gastos
      .filter((g) => ((g.moneda ?? "ARS") === "USD" ? "USD" : "ARS") === moneda)
      .reduce((acc, g) => acc + (typeof g.monto === "number" ? g.monto : 0), 0);
    return monto + extraMismaMmoneda;
  }

  private assertPagosTransportistaNoSuperanSaldo(params: {
    id?: string;
    transportistaId?: string | null;
    precioTransportistaExterno?: number | null;
    monedaPrecioTransportistaExterno?: string | null;
    pagosTransportista?: unknown;
    liquidacionesViaje?: any[];
  }): void {
    const pagos = Array.isArray(params.pagosTransportista)
      ? (params.pagosTransportista as PagoTransportistaInput[])
      : [];
    if (pagos.length === 0) return;

    if (!params.transportistaId) {
      throw new BadRequestException(
        "Este viaje no tiene transportista externo asignado.",
      );
    }

    const monedaAcordada =
      params.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";

    // Calculamos el saldo incluyendo el monto de liquidaciones, si existen
    const totalAcordado = this.calcularAcordado(params);

    const totalPagado = pagos
      .filter((p) => (p.moneda === "USD" ? "USD" : "ARS") === monedaAcordada)
      .reduce((acc, p) => {
        const monto =
          typeof p.monto === "number" && Number.isFinite(p.monto) ? p.monto : 0;
        return acc + monto;
      }, 0);

    if (totalPagado > totalAcordado + 1e-6) {
      throw new BadRequestException(
        "El monto del pago no puede superar el saldo pendiente del viaje (calculado contra la liquidación o la tarifa estimada).",
      );
    }
  }

  private async upsertCargoFinalizacion(
    tx: Prisma.TransactionClient,
    viaje: {
      id: string;
      tenantId: string;
      clienteId: string;
      numero: string;
      monto: number | null;
      monedaMonto?: string | null;
      otrosGastos?: unknown;
      fechaFinalizado: Date | null;
    },
  ) {
    const monto = this.getMontoFinal(viaje);
    const fecha = viaje.fechaFinalizado ?? new Date();
    const concepto = `Cargo automático por viaje ${viaje.numero}`;

    await tx.movimientoCuentaCorriente.upsert({
      where: {
        tenantId_viajeId: {
          tenantId: viaje.tenantId,
          viajeId: viaje.id,
        },
      },
      update: {
        clienteId: viaje.clienteId,
        tipo: "cargo",
        origen: "viaje",
        concepto,
        importe: monto,
        fecha,
        referencia: viaje.numero,
      },
      create: {
        tenantId: viaje.tenantId,
        clienteId: viaje.clienteId,
        viajeId: viaje.id,
        tipo: "cargo",
        origen: "viaje",
        concepto,
        importe: monto,
        fecha,
        referencia: viaje.numero,
      },
    });
  }

  private async assertRefs(
    tenantId: string,
    dto: {
      clienteId: string;
      transportistaId?: string | null;
      choferId?: string | null;
      transportistaEfectivoId?: string | null;
    },
  ) {
    const [c, t, ch, te] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
      dto.transportistaId
        ? this.prisma.transportista.findFirst({
            where: { id: dto.transportistaId, tenantId },
          })
        : null,
      dto.choferId
        ? this.prisma.chofer.findFirst({
            where: { id: dto.choferId, tenantId },
          })
        : null,
      dto.transportistaEfectivoId
        ? this.prisma.transportista.findFirst({
            where: { id: dto.transportistaEfectivoId, tenantId },
          })
        : null,
    ]);

    if (!c) throw new BadRequestException("Cliente inválido para este tenant");
    if (dto.transportistaId && !t)
      throw new BadRequestException("Transportista inválido");
    if (dto.choferId && !ch) throw new BadRequestException("Chofer inválido");
    if (dto.transportistaEfectivoId && !te)
      throw new BadRequestException("Transportista efectivo inválido");
    if (
      dto.transportistaEfectivoId &&
      dto.transportistaEfectivoId === dto.transportistaId
    )
      throw new BadRequestException(
        "El transportista efectivo no puede ser el mismo que el contratante",
      );
  }

  async findAll(tenantId: string, estado?: string) {
    const rows = await this.prisma.viaje.findMany({
      where: { tenantId, ...(estado ? { estado: estado } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        cliente: { select: { id: true, nombre: true } },
        transportista: { select: { id: true, nombre: true } },
        transportistaEfectivo: { select: { id: true, nombre: true } },
        destinosViaje: viajeDestinosViajeInclude,
        ...VIAJE_INCLUDE_FULL,
      } as any,
    });
    return rows.map((r) => calcularMontosReales(r));
  }

  async getStats(tenantId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // null monedaMonto/monedaPrecioTransportistaExterno is treated as ARS (same convention
    // used throughout the codebase, e.g. getViajesSaldoPendienteTransportista).
    const baseWhere = { tenantId, createdAt: { gte: monthStart } };

    const [
      estadoRows,
      ingresosARS,
      ingresosUSD,
      gastosARS,
      gastosUSD,
      saldoViajes,
    ] = await Promise.all([
      this.prisma.viaje.groupBy({
        by: ["estado"],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.viaje.aggregate({
        where: {
          ...baseWhere,
          monto: { not: null },
          monedaMonto: { not: "USD" },
        },
        _sum: { monto: true },
      }),
      this.prisma.viaje.aggregate({
        where: { ...baseWhere, monto: { not: null }, monedaMonto: "USD" },
        _sum: { monto: true },
      }),
      this.prisma.viaje.aggregate({
        where: {
          ...baseWhere,
          precioTransportistaExterno: { not: null },
          monedaPrecioTransportistaExterno: { not: "USD" },
        },
        _sum: { precioTransportistaExterno: true },
      }),
      this.prisma.viaje.aggregate({
        where: {
          ...baseWhere,
          precioTransportistaExterno: { not: null },
          monedaPrecioTransportistaExterno: "USD",
        },
        _sum: { precioTransportistaExterno: true },
      }),
      this.prisma.viaje.findMany({
        where: {
          tenantId,
          transportistaId: { not: null },
          precioTransportistaExterno: { gt: 0 },
        },
        select: {
          id: true,
          precioTransportistaExterno: true,
          monedaPrecioTransportistaExterno: true,
          pagosTransportista: true,
          liquidacionesViaje: {
            include: {
              liquidacion: {
                include: {
                  conceptosLineas: true,
                  viajes: true,
                },
              },
            },
          },
        },
      }),
    ]);

    let pendienteARS = 0;
    let pendienteUSD = 0;
    for (const v of saldoViajes) {
      const moneda =
        v.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";
      const acordado = this.calcularAcordado(v);
      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
        : [];
      const pagado = pagos
        .filter(
          (p) => ((p.moneda ?? "ARS") === "USD" ? "USD" : "ARS") === moneda,
        )
        .reduce(
          (sum, p) => sum + (typeof p.monto === "number" ? p.monto : 0),
          0,
        );
      const saldo = acordado - pagado;
      if (saldo > 0) {
        if (moneda === "ARS") pendienteARS += saldo;
        else pendienteUSD += saldo;
      }
    }

    return {
      ...Object.fromEntries(estadoRows.map((r) => [r.estado, r._count._all])),
      montos: {
        ingresos: {
          ARS: ingresosARS._sum.monto ?? 0,
          USD: ingresosUSD._sum.monto ?? 0,
        },
        gastos: {
          ARS: gastosARS._sum.precioTransportistaExterno ?? 0,
          USD: gastosUSD._sum.precioTransportistaExterno ?? 0,
        },
        pendiente: { ARS: pendienteARS, USD: pendienteUSD },
      },
    };
  }

  async findAllPaginated(tenantId: string, query: ViajesPaginatedQueryDto) {
    // Lazy update: sincroniza estados por fecha antes de devolver resultados
    await this.autoEstado.actualizarEstadosPorFecha(tenantId);

    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(query.pageSize) || 10)),
    );
    const where = buildViajesPaginatedWhere(tenantId, query);
    const { sortBy, sortDir } = resolveViajesSort(query);

    if (sortBy === "ganancia_bruta") {
      return this.findAllPaginatedOrdenGananciaBruta(
        where,
        page,
        pageSize,
        sortDir,
      );
    }

    if (sortBy === "fecha_carga" || sortBy === "fecha_descarga") {
      return this.findAllPaginatedOrdenFecha(
        where,
        page,
        pageSize,
        sortBy,
        sortDir,
      );
    }

    if (sortBy === "monto") {
      return this.findAllPaginatedOrdenMonto(where, page, pageSize, sortDir);
    }

    const orderBy = buildViajesPrismaOrderBy(sortBy, sortDir);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: VIAJE_INCLUDE_FULL,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map((item) =>
        enrichViajeConExportaciones(calcularMontosReales(item)),
      ),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  }

  private async findAllPaginatedOrdenFecha(
    where: Prisma.ViajeWhereInput,
    page: number,
    pageSize: number,
    sortBy: "fecha_carga" | "fecha_descarga",
    sortDir: ViajesSortDir,
  ) {
    const prismaField =
      sortBy === "fecha_carga" ? "fechaCarga" : "fechaDescarga";
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        select: { id: true, fechaCarga: true, fechaDescarga: true },
      }),
    ]);

    const sortedIds = rows
      .map((row) => ({
        id: row.id,
        fecha: row[prismaField],
      }))
      .sort((a, b) =>
        compareViajesFechaAr(a.fecha, b.fecha, sortDir, () =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      )
      .map((row) => row.id);

    return this.findAllPaginatedPageFromSortedIds(
      where,
      sortedIds,
      total,
      page,
      pageSize,
    );
  }

  private async findAllPaginatedOrdenMonto(
    where: Prisma.ViajeWhereInput,
    page: number,
    pageSize: number,
    sortDir: ViajesSortDir,
  ) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        select: {
          id: true,
          monto: true,
          monedaMonto: true,
          factura: VIAJE_INCLUDE_FULL.factura,
        },
      }),
    ]);

    const sortedIds = rows
      .map((row) => {
        const conReales = calcularMontosReales(row);
        const valorMonto = conReales.montoFacturadoReal ?? row.monto;
        return { id: row.id, valor: valorMonto };
      })
      .sort((a, b) =>
        compareViajesOrdenNullable(a.valor, b.valor, sortDir, () =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      )
      .map((row) => row.id);

    return this.findAllPaginatedPageFromSortedIds(
      where,
      sortedIds,
      total,
      page,
      pageSize,
    );
  }

  private async findAllPaginatedOrdenGananciaBruta(
    where: Prisma.ViajeWhereInput,
    page: number,
    pageSize: number,
    sortDir: ViajesSortDir,
  ) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        select: {
          id: true,
          monto: true,
          monedaMonto: true,
          precioTransportistaExterno: true,
          monedaPrecioTransportistaExterno: true,
          otrosGastos: true,
          gananciaBrutaManual: true,
          monedaGananciaBrutaManual: true,
          factura: VIAJE_INCLUDE_FULL.factura,
          liquidacionesViaje: VIAJE_INCLUDE_FULL.liquidacionesViaje,
        },
      }),
    ]);

    const sortedIds = rows
      .map((row) => {
        const conReales = calcularMontosReales(row);
        const viaParaOrden = {
          ...row,
          monto: conReales.montoFacturadoReal ?? row.monto,
          monedaMonto: conReales.monedaMontoFacturadoReal ?? row.monedaMonto,
          precioTransportistaExterno:
            conReales.costoLiquidadoReal ?? row.precioTransportistaExterno,
          monedaPrecioTransportistaExterno:
            conReales.monedaCostoLiquidadoReal ??
            row.monedaPrecioTransportistaExterno,
        };
        return {
          id: row.id,
          valor: gananciaBrutaValorOrdenable(viaParaOrden as any),
        };
      })
      .sort((a, b) =>
        compareViajesOrdenNullable(a.valor, b.valor, sortDir, () =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      )
      .map((row) => row.id);

    return this.findAllPaginatedPageFromSortedIds(
      where,
      sortedIds,
      total,
      page,
      pageSize,
    );
  }

  private async findAllPaginatedPageFromSortedIds(
    _where: Prisma.ViajeWhereInput,
    sortedIds: string[],
    total: number,
    page: number,
    pageSize: number,
  ) {
    const pageIds = sortedIds.slice((page - 1) * pageSize, page * pageSize);
    const itemsUnsorted =
      pageIds.length === 0
        ? []
        : await this.prisma.viaje.findMany({
            where: { id: { in: pageIds } },
            include: VIAJE_INCLUDE_FULL,
          });
    const byId = new Map(itemsUnsorted.map((item) => [item.id, item]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => item != null);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map((item) =>
        enrichViajeConExportaciones(calcularMontosReales(item)),
      ),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  }

  async findOne(id: string, tenantId: string): Promise<ViajeConVehiculosViaje> {
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      include: VIAJE_INCLUDE_FULL,
    });
    if (!row) throw new NotFoundException("Viaje no encontrado");
    return enrichViajeConGananciaBruta(
      enrichViajeConExportaciones(
        calcularMontosReales(row) as unknown as ViajeConVehiculosViaje,
      ),
    ) as ViajeConVehiculosViaje;
  }

  async getGananciaBruta(id: string, tenantId: string) {
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: {
        monto: true,
        monedaMonto: true,
        precioTransportistaExterno: true,
        monedaPrecioTransportistaExterno: true,
        otrosGastos: true,
        gananciaBrutaManual: true,
        monedaGananciaBrutaManual: true,
        factura: VIAJE_INCLUDE_FULL.factura,
        liquidacionesViaje: VIAJE_INCLUDE_FULL.liquidacionesViaje,
      },
    });
    if (!row) throw new NotFoundException("Viaje no encontrado");

    const conReales = calcularMontosReales(row);
    const viaParaResumen = {
      ...row,
      monto: conReales.montoFacturadoReal ?? row.monto,
      monedaMonto: conReales.monedaMontoFacturadoReal ?? row.monedaMonto,
      precioTransportistaExterno:
        conReales.costoLiquidadoReal ?? row.precioTransportistaExterno,
      monedaPrecioTransportistaExterno:
        conReales.monedaCostoLiquidadoReal ??
        row.monedaPrecioTransportistaExterno,
    };
    return buildGananciaBrutaResumen(viaParaResumen as any);
  }

  async getExportaciones(id: string, tenantId: string) {
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: { id: true, numero: true, transportistaId: true },
    });
    if (!row) throw new NotFoundException("Viaje no encontrado");
    return buildViajeExportacionesResponse(row);
  }

  async create(tenantId: string, userId: string, dto: CreateViajeDto) {
    const op = mergeViajeOperacionIds(
      { transportistaId: null, choferId: null, vehiculoIds: [] },
      {
        transportistaId: dto.transportistaId,
        choferId: dto.choferId,
        vehiculoIds: dto.vehiculoIds,
      },
    );
    const transportistaExterno = op.transportistaId?.trim();
    const vehiculoIds = op.vehiculoIds;
    const contratanteRealizaFlete =
      dto.contratanteRealizaFlete === true ||
      dto.contratanteRealizaFlete === false
        ? dto.contratanteRealizaFlete
        : resolveContratanteRealizaFlete({
            flag: dto.contratanteRealizaFlete,
            transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
            hasTransportistaExterno: !!transportistaExterno,
          });
    const transportistaEfectivoId =
      dto.contratanteRealizaFlete === false
        ? (dto.transportistaEfectivoId ?? "").trim() || null
        : dto.contratanteRealizaFlete === true
          ? null
          : resolveTransportistaEfectivoIdPersist({
              hasTransportistaExterno: !!transportistaExterno,
              contratanteRealizaFlete,
              transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
            });
    assertTransportistaEfectivoSubcontratacion({
      transportistaId: transportistaExterno,
      transportistaEfectivoId,
      contratanteRealizaFlete,
    });
    const refs = {
      clienteId: dto.clienteId,
      transportistaId: op.transportistaId,
      choferId: op.choferId,
      transportistaEfectivoId,
    };
    await this.assertRefs(tenantId, refs);
    if (!transportistaExterno) {
      await assertVehiculosDelViaje(this.prisma, tenantId, vehiculoIds, {
        requiereFlotaPropia: true,
      });
    } else if (vehiculoIds.length > 0) {
      await assertVehiculosDelViaje(this.prisma, tenantId, vehiculoIds, {
        requiereFlotaPropia: false,
      });
    }
    const productoItemsNorm = normalizarProductoItems(dto.productoItems);
    await assertProductosAsignables(this.prisma, tenantId, productoItemsNorm, {
      modo: "create",
    });
    assertFechaDescargaValida(
      new Date(dto.fechaCarga),
      new Date(dto.fechaDescarga),
    );
    const estado = this.parseEstadoViaje(dto.estado);
    if (esEstadoViajeFinal(estado)) {
      throw new BadRequestException(
        "Un viaje no puede crearse en un estado final",
      );
    }
    const precioTransportistaExterno = dto.precioTransportistaExterno;
    const numero =
      dto.numero?.trim() || (await generateNumeroViaje(this.prisma, tenantId));
    const gananciaPersist = this.applyGananciaBrutaFields(
      {
        monto: dto.monto,
        monedaMonto: dto.monedaMonto,
        monedaPrecioTransportistaExterno: dto.monedaPrecioTransportistaExterno,
        otrosGastos: dto.otrosGastos,
      },
      dto,
    );
    this.assertPagosTransportistaNoSuperanSaldo({
      id: undefined,
      transportistaId: refs.transportistaId,
      precioTransportistaExterno,
      monedaPrecioTransportistaExterno: dto.monedaPrecioTransportistaExterno,
      pagosTransportista: dto.pagosTransportista,
      liquidacionesViaje: [], // Al crearse, obviamente no tiene liquidaciones.
    });
    const destinosNorm = resolveDestinosParaCreate(dto);
    const destinoFinal = ultimoDestinoEtiqueta(destinosNorm);

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.ViajeUncheckedCreateInput = {
        tenantId,
        numero,
        estado,
        clienteId: dto.clienteId,
        transportistaId: refs.transportistaId,
        transportistaEfectivoId: refs.transportistaEfectivoId,
        choferId: refs.choferId,
        origen: dto.origen ?? null,
        destino: destinoFinal,
        fechaCarga: new Date(dto.fechaCarga),
        fechaDescarga: new Date(dto.fechaDescarga),
        detalleCarga: dto.detalleCarga ?? null,
        kmRecorridos: dto.kmRecorridos ?? null,
        litrosConsumidos: dto.litrosConsumidos ?? null,
        monto: dto.monto,
        monedaMonto: dto.monedaMonto === "USD" ? "USD" : "ARS",
        precioTransportistaExterno: precioTransportistaExterno ?? null,
        monedaPrecioTransportistaExterno:
          dto.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS",
        gananciaBrutaManual: gananciaPersist.gananciaBrutaManual,
        monedaGananciaBrutaManual: gananciaPersist.monedaGananciaBrutaManual,
        observaciones: dto.observaciones ?? null,
        otrosGastos: dto.otrosGastos
          ? (dto.otrosGastos as unknown as Prisma.InputJsonValue)
          : [],
        pagosTransportista: dto.pagosTransportista
          ? (dto.pagosTransportista as unknown as Prisma.InputJsonValue)
          : [],
        createdBy: userId,
      };
      const viaje = await tx.viaje.create({ data });
      await reemplazarVehiculosDelViaje(tx, viaje.id, vehiculoIds, tenantId);
      await reemplazarProductosDelViaje(
        tx,
        viaje.id,
        productoItemsNorm,
        tenantId,
      );
      await reemplazarDestinosDelViaje(tx, viaje.id, destinosNorm, tenantId);
      const out = await tx.viaje.findFirstOrThrow({
        where: { id: viaje.id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      });
      return enrichViajeConGananciaBruta(
        calcularMontosReales(out) as unknown as ViajeConVehiculosViaje,
      ) as ViajeConVehiculosViaje;
    }, VIAJE_INTERACTIVE_TX);
  }

  async update(id: string, tenantId: string, dto: UpdateViajeDto) {
    const current = await this.findOne(id, tenantId);

    const bloqueadoPorFactura = Boolean((current as any).factura);

    const bloqueadoPorLiquidacion =
      (current as any).liquidacionesViaje?.some(
        (lv: any) => lv.liquidacion.estado !== "anulado",
      ) ?? false;

    if (bloqueadoPorFactura || bloqueadoPorLiquidacion) {
      const motivo =
        bloqueadoPorFactura && bloqueadoPorLiquidacion
          ? "facturado y liquidado"
          : bloqueadoPorFactura
            ? "facturado"
            : "liquidado";
      throw new ConflictException(
        `No se puede editar: el viaje ya fue ${motivo}.`,
      );
    }

    const currentIds = current.vehiculosViaje.map((x) => x.vehiculoId);
    const op = mergeViajeOperacionIds(
      {
        transportistaId: current.transportistaId,
        choferId: current.choferId,
        vehiculoIds: currentIds,
      },
      dto,
    );
    const currentTeId = (current as { transportistaEfectivoId?: string | null })
      .transportistaEfectivoId;
    const contratanteRealizaFlete =
      dto.contratanteRealizaFlete === true ||
      dto.contratanteRealizaFlete === false
        ? dto.contratanteRealizaFlete
        : resolveContratanteRealizaFlete({
            flag: dto.contratanteRealizaFlete,
            transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
            currentTransportistaEfectivoId: currentTeId,
            hasTransportistaExterno: !!op.transportistaId,
          });
    const transportistaEfectivoIdUpdate = !op.transportistaId
      ? null
      : dto.contratanteRealizaFlete === false
        ? (dto.transportistaEfectivoId ?? "").trim() || null
        : dto.contratanteRealizaFlete === true
          ? null
          : resolveTransportistaEfectivoIdPersist({
              hasTransportistaExterno: true,
              contratanteRealizaFlete,
              transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
              currentTransportistaEfectivoId: currentTeId,
            });
    assertTransportistaEfectivoSubcontratacion({
      transportistaId: op.transportistaId,
      transportistaEfectivoId: transportistaEfectivoIdUpdate,
      contratanteRealizaFlete,
    });
    const merged = {
      clienteId: dto.clienteId ?? current.clienteId,
      transportistaId: op.transportistaId,
      choferId: op.choferId,
      transportistaEfectivoId: transportistaEfectivoIdUpdate,
    };
    await this.assertRefs(tenantId, merged);
    if (dto.fechaCarga !== undefined && !dto.fechaCarga)
      throw new BadRequestException("La fecha de carga es requerida");
    if (dto.fechaDescarga !== undefined && !dto.fechaDescarga)
      throw new BadRequestException("La fecha de descarga es requerida");
    const fcResolved = dto.fechaCarga
      ? new Date(dto.fechaCarga)
      : current.fechaCarga;
    const fdResolved = dto.fechaDescarga
      ? new Date(dto.fechaDescarga)
      : current.fechaDescarga;
    if (fcResolved && fdResolved)
      assertFechaDescargaValida(fcResolved, fdResolved);
    if (!op.transportistaId) {
      await assertVehiculosDelViaje(this.prisma, tenantId, op.vehiculoIds, {
        requiereFlotaPropia: true,
      });
    }

    if (dto.productoItems !== undefined) {
      const nextProductos = normalizarProductoItems(dto.productoItems);
      await assertProductosAsignables(this.prisma, tenantId, nextProductos, {
        modo: "update",
        currentProductoIds: new Set(idsProductosDelViaje(current)),
      });
    }

    const precioTransportistaExternoInput = dto.precioTransportistaExterno;
    const precioTransportistaExternoResolved =
      precioTransportistaExternoInput !== undefined
        ? precioTransportistaExternoInput
        : current.precioTransportistaExterno;
    const monedaPrecioTransportistaExternoResolved =
      dto.monedaPrecioTransportistaExterno ??
      current.monedaPrecioTransportistaExterno;
    const pagosTransportistaResolved =
      dto.pagosTransportista !== undefined
        ? dto.pagosTransportista
        : current.pagosTransportista;
    const currentNorm = this.parseEstadoViaje(
      current.estado != null && String(current.estado).trim() !== ""
        ? String(current.estado)
        : "pendiente",
    );
    const estadoSiguiente =
      dto.estado != null && String(dto.estado).trim() !== ""
        ? this.parseEstadoViaje(String(dto.estado))
        : currentNorm;

    const data: Prisma.ViajeUpdateInput = {
      ...dto,
      monto: dto.monto !== undefined ? dto.monto : (current.monto ?? undefined),
      fechaCarga:
        dto.fechaCarga === undefined
          ? undefined
          : dto.fechaCarga
            ? new Date(dto.fechaCarga)
            : null,
      fechaDescarga:
        dto.fechaDescarga === undefined
          ? undefined
          : dto.fechaDescarga
            ? new Date(dto.fechaDescarga)
            : null,
    } as any;
    delete (data as { vehiculoIds?: unknown }).vehiculoIds;
    delete (data as { productoItems?: unknown }).productoItems;
    delete (data as { destinos?: unknown }).destinos;
    delete (data as { contratanteRealizaFlete?: unknown })
      .contratanteRealizaFlete;
    delete (data as { transportistaEfectivoId?: unknown })
      .transportistaEfectivoId;
    if (dto.otrosGastos !== undefined) {
      (data as any).otrosGastos =
        dto.otrosGastos as unknown as Prisma.InputJsonValue;
    }
    if (dto.pagosTransportista !== undefined) {
      (data as any).pagosTransportista =
        dto.pagosTransportista as unknown as Prisma.InputJsonValue;
    }

    if (precioTransportistaExternoInput !== undefined) {
      (data as any).precioTransportistaExterno =
        precioTransportistaExternoInput;
    }
    if (dto.monedaMonto !== undefined) {
      (data as any).monedaMonto = dto.monedaMonto === "USD" ? "USD" : "ARS";
    }
    if (dto.monedaPrecioTransportistaExterno !== undefined) {
      (data as any).monedaPrecioTransportistaExterno =
        dto.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";
    }
    if (
      !esEstadoViajeFinal(currentNorm) &&
      esEstadoViajeFinal(estadoSiguiente)
    ) {
      data.fechaFinalizado = new Date();
    }

    (data as any).estado = estadoSiguiente;
    (data as any).transportistaId = op.transportistaId;
    (data as any).transportistaEfectivoId = merged.transportistaEfectivoId;
    (data as any).choferId = op.choferId;

    const gananciaPersist = this.applyGananciaBrutaFields(
      {
        monto: (data as { monto?: number }).monto ?? current.monto,
        monedaMonto:
          (data as { monedaMonto?: string }).monedaMonto ?? current.monedaMonto,
        monedaPrecioTransportistaExterno:
          (data as { monedaPrecioTransportistaExterno?: string })
            .monedaPrecioTransportistaExterno ??
          current.monedaPrecioTransportistaExterno,
        otrosGastos:
          dto.otrosGastos !== undefined ? dto.otrosGastos : current.otrosGastos,
      },
      {
        gananciaBrutaManual: dto.gananciaBrutaManual,
        monedaGananciaBrutaManual: dto.monedaGananciaBrutaManual,
        monedaMonto: dto.monedaMonto,
        monedaPrecioTransportistaExterno: dto.monedaPrecioTransportistaExterno,
        otrosGastos: dto.otrosGastos,
      },
      {
        gananciaBrutaManual: current.gananciaBrutaManual,
        monedaGananciaBrutaManual: current.monedaGananciaBrutaManual,
      },
    );
    delete (data as { gananciaBrutaManual?: unknown }).gananciaBrutaManual;
    delete (data as { monedaGananciaBrutaManual?: unknown })
      .monedaGananciaBrutaManual;
    (data as any).gananciaBrutaManual = gananciaPersist.gananciaBrutaManual;

    (data as any).monedaGananciaBrutaManual =
      gananciaPersist.monedaGananciaBrutaManual;
    if (!op.transportistaId) {
      (data as any).pagosTransportista = [];
    } else if (
      dto.pagosTransportista !== undefined ||
      precioTransportistaExternoInput !== undefined ||
      dto.monedaPrecioTransportistaExterno !== undefined
    ) {
      this.assertPagosTransportistaNoSuperanSaldo({
        id,
        transportistaId: op.transportistaId,
        precioTransportistaExterno: precioTransportistaExternoResolved,
        monedaPrecioTransportistaExterno:
          monedaPrecioTransportistaExternoResolved,
        pagosTransportista: pagosTransportistaResolved,
        liquidacionesViaje: (current as any).liquidacionesViaje,
      });
    }

    const destinosUpdate = resolveDestinosParaUpdate(dto);
    if (destinosUpdate !== undefined) {
      (data as any).destino = ultimoDestinoEtiqueta(destinosUpdate);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.viaje.update({
        where: { id },
        data: data as Prisma.ViajeUncheckedUpdateInput,
      });
      await reemplazarVehiculosDelViaje(tx, id, op.vehiculoIds, tenantId);
      if (dto.productoItems !== undefined) {
        await reemplazarProductosDelViaje(
          tx,
          id,
          normalizarProductoItems(dto.productoItems),
          tenantId,
        );
      }
      if (destinosUpdate !== undefined) {
        await reemplazarDestinosDelViaje(tx, id, destinosUpdate, tenantId);
      }
      const full = (await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      })) as unknown as ViajeConVehiculosViaje;
      if (esEstadoViajeFinal(full.estado)) {
        await this.upsertCargoFinalizacion(tx, full);
      }
      return enrichViajeConGananciaBruta(
        calcularMontosReales(full) as any,
      ) as ViajeConVehiculosViaje;
    }, VIAJE_INTERACTIVE_TX);
  }

  async addGasto(
    id: string,
    tenantId: string,
    userId: string,
    dto: AddGastoDto,
  ) {
    const viaje = await this.findOne(id, tenantId);

    const ESTADOS_BLOQUEADOS = ["facturado_sin_cobrar", "cobrado", "cancelado"];
    if (ESTADOS_BLOQUEADOS.includes(viaje.estado)) {
      throw new BadRequestException(
        "No se pueden agregar gastos a un viaje facturado o cancelado.",
      );
    }

    const gastosActuales = Array.isArray(viaje.otrosGastos)
      ? (viaje.otrosGastos as Array<Record<string, unknown>>)
      : [];

    const nuevoGasto: Record<string, unknown> = {
      descripcion: dto.descripcion.trim(),
      monto: dto.monto,
      moneda: dto.moneda,
      createdBy: userId,
    };
    if (dto.fecha) nuevoGasto.fecha = dto.fecha;

    const gastosActualizados = [...gastosActuales, nuevoGasto];

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: {
          otrosGastos: gastosActualizados as unknown as Prisma.InputJsonValue,
        },
      });

      const full = (await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      })) as unknown as ViajeConVehiculosViaje;

      if (esEstadoViajeFinal(full.estado)) {
        await this.upsertCargoFinalizacion(tx, full);
      }

      return calcularMontosReales(full);
    }, VIAJE_INTERACTIVE_TX);
  }

  async addPagoTransportista(
    id: string,
    tenantId: string,
    userId: string,
    dto: AddPagoTransportistaDto,
  ) {
    const viaje = await this.findOne(id, tenantId);

    if (viaje.estado === "cancelado") {
      throw new BadRequestException(
        "No se pueden registrar pagos en un viaje cancelado.",
      );
    }
    if (!viaje.transportistaId) {
      throw new BadRequestException(
        "Este viaje no tiene transportista externo asignado.",
      );
    }

    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];

    const nuevoPago: Record<string, unknown> = {
      monto: dto.monto,
      moneda: dto.moneda,
      fecha: dto.fecha,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
    if (dto.observaciones?.trim())
      nuevoPago.observaciones = dto.observaciones.trim();
    if (dto.comprobante?.trim()) nuevoPago.comprobante = dto.comprobante.trim();

    const pagosActualizados = [...pagosActuales, nuevoPago];

    this.assertPagosTransportistaNoSuperanSaldo({
      id: viaje.id,
      transportistaId: viaje.transportistaId,
      precioTransportistaExterno: viaje.precioTransportistaExterno,
      monedaPrecioTransportistaExterno: viaje.monedaPrecioTransportistaExterno,
      pagosTransportista: pagosActualizados,
      liquidacionesViaje: (viaje as any).liquidacionesViaje,
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: {
          pagosTransportista:
            pagosActualizados as unknown as Prisma.InputJsonValue,
        },
      });
      const out = await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      });
      return calcularMontosReales(out) as unknown as ViajeConVehiculosViaje;
    }, VIAJE_INTERACTIVE_TX);
  }

  async deletePagoTransportista(
    id: string,
    tenantId: string,
    userId: string,
    index: number,
  ) {
    const viaje = await this.findOne(id, tenantId);

    if (viaje.estado === "cancelado") {
      throw new BadRequestException(
        "No se pueden eliminar pagos en un viaje cancelado.",
      );
    }
    if (!viaje.transportistaId) {
      throw new BadRequestException(
        "Este viaje no tiene transportista externo asignado.",
      );
    }

    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];

    if (index < 0 || index >= pagosActuales.length) {
      throw new BadRequestException("Pago inválido.");
    }

    const pagosActualizados = pagosActuales.filter((_, idx) => idx !== index);

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: {
          pagosTransportista:
            pagosActualizados as unknown as Prisma.InputJsonValue,
        },
      });
      const out = await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      });
      return calcularMontosReales(out) as unknown as ViajeConVehiculosViaje;
    }, VIAJE_INTERACTIVE_TX);
  }

  async getViajesSaldoPendienteTransportista(tenantId: string) {
    const viajes = await this.prisma.viaje.findMany({
      where: {
        tenantId,
        transportistaId: { not: null },
        precioTransportistaExterno: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      include: {
        cliente: { select: { id: true, nombre: true } },
        transportista: { select: { id: true, nombre: true } },
        factura: { select: { id: true, numero: true } },
        liquidacionesViaje: {
          include: {
            liquidacion: {
              include: {
                conceptosLineas: true,
                viajes: true,
              },
            },
          },
        },
      },
    });

    return viajes.filter((v) => {
      const moneda =
        v.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";

      const acordado = this.calcularAcordado(v);

      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
        : [];
      const pagado = pagos
        .filter(
          (p) => ((p.moneda ?? "ARS") === "USD" ? "USD" : "ARS") === moneda,
        )
        .reduce(
          (acc, p) => acc + (typeof p.monto === "number" ? p.monto : 0),
          0,
        );
      return pagado < acordado;
    });
  }

  async remove(id: string, tenantId: string, force = false) {
    const viaje = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        liquidacionesViaje: {
          select: {
            liquidacion: {
              select: {
                id: true,
                estado: true,
                cae: true,
                cbteNro: true,
                ptoVenta: true,
                periodoDesde: true,
                periodoHasta: true,
                transportista: { select: { nombre: true } },
              },
            },
          },
        },
      },
    });
    if (!viaje) throw new NotFoundException("Viaje no encontrado");

    const liquidaciones = [
      ...new Map(
        viaje.liquidacionesViaje.map((lv) => [lv.liquidacion.id, lv.liquidacion]),
      ).values(),
    ];

    const toImpactoDto = (l: (typeof liquidaciones)[number]) => ({
      id: l.id,
      transportistaNombre: l.transportista.nombre,
      estado: l.estado,
      tieneCae: Boolean(l.cae),
      cbteNro: l.cbteNro,
      ptoVenta: l.ptoVenta,
      periodoDesde: l.periodoDesde,
      periodoHasta: l.periodoHasta,
    });

    const autorizadas = liquidaciones.filter(
      (l) => l.estado === "autorizado" || l.estado === "anulado",
    );
    if (autorizadas.length > 0) {
      throw new ConflictException({
        message:
          "No se puede eliminar el viaje: está incluido en una liquidación ya autorizada o anulada en AFIP.",
        code: "VIAJE_LIQUIDACION_AUTORIZADA",
        liquidaciones: autorizadas.map(toImpactoDto),
      });
    }

    if (liquidaciones.length > 0 && !force) {
      throw new ConflictException({
        message:
          "Este viaje está incluido en liquidaciones que todavía no fueron autorizadas por AFIP. Si continuás, también se van a eliminar.",
        code: "VIAJE_TIENE_LIQUIDACIONES",
        liquidaciones: liquidaciones.map(toImpactoDto),
      });
    }

    return this.prisma.$transaction(async (tx) => {
      for (const liq of liquidaciones) {
        await tx.liquidacionViaje.deleteMany({
          where: { liquidacionId: liq.id, viajeId: id },
        });
        const restantes = await tx.liquidacionViaje.count({
          where: { liquidacionId: liq.id },
        });
        if (restantes === 0) {
          await tx.liquidacion.delete({ where: { id: liq.id } });
        }
      }
      const { count } = await tx.viaje.deleteMany({ where: { id, tenantId } });
      if (count === 0) throw new NotFoundException("Viaje no encontrado");
      return { id };
    });
  }
}
