import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ViajesAutoEstadoService } from './viajes-auto-estado.service';
import { CreateViajeDto } from './dto/create-viaje.dto';
import { AddGastoDto } from './dto/add-gasto.dto';
import { AddPagoTransportistaDto } from './dto/add-pago-transportista.dto';
import { generateNumeroViaje } from './generate-viaje-numero';
import {
  assertViajeOperacionExclusiva,
  assertTransportistaEfectivoSubcontratacion,
  mergeViajeOperacionIds,
  resolveContratanteRealizaFlete,
  resolveTransportistaEfectivoIdPersist,
} from './viaje-operacion-exclusiva';
import {
  assertVehiculosDelViaje,
  idsProductosDelViaje,
  normalizarDestinosDelViaje,
  normalizarVehiculoIds,
  reemplazarDestinosDelViaje,
  reemplazarProductosDelViaje,
  reemplazarVehiculosDelViaje,
  ultimoDestinoEtiqueta,
  viajeDestinosViajeInclude,
  VIAJE_INCLUDE_VEHICULOS_INCLUDE,
  type ViajeConVehiculosViaje,
} from './viaje-vehiculos.helper';
import { UpdateViajeDto } from './dto/update-viaje.dto';
import { ViajesPaginatedQueryDto } from './dto/viajes-paginated-query.dto';
import { Prisma} from '@prisma/client';
import {
  VIAJE_ESTADOS_SET,
  esEstadoViajeFinal,
  normalizarEstadoViaje,
  type ViajeEstado,
} from './viaje-estados';
import {
  buildViajeExportacionesResponse,
  enrichViajeConExportaciones,
} from './viaje-exportaciones.util';
import {
  GananciaBrutaValidationError,
  buildGananciaBrutaResumen,
  enrichViajeConGananciaBruta,
  gananciaBrutaValorOrdenable,
  resolveGananciaBrutaPersist,
} from './viaje-ganancia-bruta.util';
import {
  buildViajesPaginatedWhere,
  buildViajesPrismaOrderBy,
  compareViajesFechaAr,
  compareViajesOrdenNullable,
  resolveViajesSort,
  type ViajesSortDir,
} from './viajes-paginated-query.util';

type ProductoItem = { productoId: string; cantidad?: number; pesoKg?: number };
type DestinoItem = { etiqueta: string };

function resolveDestinosParaCreate(dto: CreateViajeDto): DestinoItem[] {
  const fromArray = normalizarDestinosDelViaje(dto.destinos);
  if (fromArray.length > 0) return fromArray;
  const legacy = dto.destino?.trim();
  if (legacy) return [{ etiqueta: legacy }];
  throw new BadRequestException('Ingresá al menos un destino.');
}

function resolveDestinosParaUpdate(dto: UpdateViajeDto): DestinoItem[] | undefined {
  if (dto.destinos !== undefined) {
    const norm = normalizarDestinosDelViaje(dto.destinos);
    if (norm.length === 0) {
      throw new BadRequestException('Ingresá al menos un destino.');
    }
    return norm;
  }
  if (dto.destino !== undefined) {
    const legacy = dto.destino?.trim();
    if (!legacy) {
      throw new BadRequestException('El destino no puede estar vacío.');
    }
    return [{ etiqueta: legacy }];
  }
  return undefined;
}

function normalizarProductoItems(raw: ProductoItem[] | undefined | null): ProductoItem[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: ProductoItem[] = [];
  for (const item of raw) {
    const id = String(item.productoId ?? '').trim();
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
  opts: { modo: 'create' | 'update'; currentProductoIds?: ReadonlySet<string> },
): Promise<void> {
  if (items.length === 0) return;
  const ids = items.map((i) => i.productoId);
  const rows = await prisma.producto.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, activo: true },
  });
  if (rows.length !== ids.length) {
    throw new BadRequestException('Algún producto no existe o no pertenece a esta empresa.');
  }
  const current = opts.currentProductoIds ?? new Set<string>();
  for (const row of rows) {
    if (!row.activo) {
      const conserva = opts.modo === 'update' && current.has(row.id);
      if (opts.modo === 'create' || !conserva) {
        throw new BadRequestException(
          'Ese producto está inactivo. Elegí otro o reactivalo desde Productos.',
        );
      }
    }
  }
}

function assertFechaDescargaValida(fechaCarga: Date, fechaDescarga: Date): void {
  const fc = new Date(fechaCarga.toISOString().slice(0, 10));
  const fd = new Date(fechaDescarga.toISOString().slice(0, 10));
  if (fd < fc) {
    throw new BadRequestException(
      'La fecha de descarga no puede ser anterior a la fecha de carga.',
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
      throw new BadRequestException('Estado de viaje inválido');
    }
    return n as ViajeEstado;
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
  ): { gananciaBrutaManual: number | null; monedaGananciaBrutaManual: string | null } {
    try {
      return resolveGananciaBrutaPersist(
        {
          monto: viaje.monto,
          monedaMonto: dto.monedaMonto ?? viaje.monedaMonto,
          monedaPrecioTransportistaExterno:
            dto.monedaPrecioTransportistaExterno ?? viaje.monedaPrecioTransportistaExterno,
          otrosGastos: dto.otrosGastos !== undefined ? dto.otrosGastos : viaje.otrosGastos,
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

  private getMontoFinal(viaje: { monto: number | null; monedaMonto?: string | null; otrosGastos?: unknown }) {
    const monto = viaje.monto;
    if (monto == null || monto <= 0) {
      throw new BadRequestException(
        'Para finalizar un viaje se requiere un monto mayor a 0',
      );
    }
    // Sumar otrosGastos en la misma moneda que monto
    const moneda = (viaje.monedaMonto ?? 'ARS') === 'USD' ? 'USD' : 'ARS';
    const gastos = Array.isArray(viaje.otrosGastos)
      ? (viaje.otrosGastos as Array<{ monto?: number; moneda?: string }>)
      : [];
    const extraMismaMmoneda = gastos
      .filter((g) => ((g.moneda ?? 'ARS') === 'USD' ? 'USD' : 'ARS') === moneda)
      .reduce((acc, g) => acc + (typeof g.monto === 'number' ? g.monto : 0), 0);
    return monto + extraMismaMmoneda;
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
        tipo: 'cargo',
        origen: 'viaje',
        concepto,
        importe: monto,
        fecha,
        referencia: viaje.numero,
      },
      create: {
        tenantId: viaje.tenantId,
        clienteId: viaje.clienteId,
        viajeId: viaje.id,
        tipo: 'cargo',
        origen: 'viaje',
        concepto,
        importe: monto,
        fecha,
        referencia: viaje.numero,
      },
    });
  }

  private async assertRefs(tenantId: string, dto: {
    clienteId: string;
    transportistaId?: string | null;
    choferId?: string | null;
    transportistaEfectivoId?: string | null;
  }) {
    const [c, t, ch, te] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
      dto.transportistaId
        ? this.prisma.transportista.findFirst({ where: { id: dto.transportistaId, tenantId } })
        : null,
      dto.choferId
        ? this.prisma.chofer.findFirst({ where: { id: dto.choferId, tenantId } })
        : null,
      dto.transportistaEfectivoId
        ? this.prisma.transportista.findFirst({ where: { id: dto.transportistaEfectivoId, tenantId } })
        : null,
    ]);

    if (!c) throw new BadRequestException('Cliente inválido para este tenant');
    if (dto.transportistaId && !t) throw new BadRequestException('Transportista inválido');
    if (dto.choferId && !ch) throw new BadRequestException('Chofer inválido');
    if (dto.transportistaEfectivoId && !te)
      throw new BadRequestException('Transportista efectivo inválido');
    if (dto.transportistaEfectivoId && dto.transportistaEfectivoId === dto.transportistaId)
      throw new BadRequestException('El transportista efectivo no puede ser el mismo que el contratante');
  }

  async findAll(tenantId: string, estado?: string) {
    return this.prisma.viaje.findMany({
      where: { tenantId, ...(estado ? { estado: estado } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        cliente:              { select: { id: true, nombre: true } },
        transportista:        { select: { id: true, nombre: true } },
        transportistaEfectivo: { select: { id: true, nombre: true } },
        factura:              { select: { id: true, numero: true } },
        destinosViaje: viajeDestinosViajeInclude,
      } as any,
    });
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
        by: ['estado'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.viaje.aggregate({
        where: { ...baseWhere, monto: { not: null }, monedaMonto: { not: 'USD' } },
        _sum: { monto: true },
      }),
      this.prisma.viaje.aggregate({
        where: { ...baseWhere, monto: { not: null }, monedaMonto: 'USD' },
        _sum: { monto: true },
      }),
      this.prisma.viaje.aggregate({
        where: { ...baseWhere, precioTransportistaExterno: { not: null }, monedaPrecioTransportistaExterno: { not: 'USD' } },
        _sum: { precioTransportistaExterno: true },
      }),
      this.prisma.viaje.aggregate({
        where: { ...baseWhere, precioTransportistaExterno: { not: null }, monedaPrecioTransportistaExterno: 'USD' },
        _sum: { precioTransportistaExterno: true },
      }),
      this.prisma.viaje.findMany({
        where: { tenantId, transportistaId: { not: null }, precioTransportistaExterno: { gt: 0 } },
        select: {
          precioTransportistaExterno: true,
          monedaPrecioTransportistaExterno: true,
          pagosTransportista: true,
        },
      }),
    ]);

    let pendienteARS = 0;
    let pendienteUSD = 0;
    for (const v of saldoViajes) {
      const moneda = v.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS';
      const acordado = v.precioTransportistaExterno ?? 0;
      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
        : [];
      const pagado = pagos
        .filter((p) => ((p.moneda ?? 'ARS') === 'USD' ? 'USD' : 'ARS') === moneda)
        .reduce((sum, p) => sum + (typeof p.monto === 'number' ? p.monto : 0), 0);
      const saldo = acordado - pagado;
      if (saldo > 0) {
        if (moneda === 'ARS') pendienteARS += saldo;
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

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = buildViajesPaginatedWhere(tenantId, query);
    const { sortBy, sortDir } = resolveViajesSort(query);

    if (sortBy === 'ganancia_bruta') {
      return this.findAllPaginatedOrdenGananciaBruta(where, page, pageSize, sortDir);
    }

    if (sortBy === 'fecha_carga' || sortBy === 'fecha_descarga') {
      return this.findAllPaginatedOrdenFecha(where, page, pageSize, sortBy, sortDir);
    }

    const orderBy = buildViajesPrismaOrderBy(sortBy, sortDir);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map((item) => enrichViajeConExportaciones(item)),
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
    sortBy: 'fecha_carga' | 'fecha_descarga',
    sortDir: ViajesSortDir,
  ) {
    const prismaField = sortBy === 'fecha_carga' ? 'fechaCarga' : 'fechaDescarga';
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

    return this.findAllPaginatedPageFromSortedIds(where, sortedIds, total, page, pageSize);
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
        },
      }),
    ]);

    const sortedIds = rows
      .map((row) => ({ id: row.id, valor: gananciaBrutaValorOrdenable(row) }))
      .sort((a, b) =>
        compareViajesOrdenNullable(a.valor, b.valor, sortDir, () =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      )
      .map((row) => row.id);

    return this.findAllPaginatedPageFromSortedIds(where, sortedIds, total, page, pageSize);
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
            include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
          });
    const byId = new Map(itemsUnsorted.map((item) => [item.id, item]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => item != null);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map((item) => enrichViajeConExportaciones(item)),
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
      include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
    });
    if (!row) throw new NotFoundException('Viaje no encontrado');
    return enrichViajeConGananciaBruta(
      enrichViajeConExportaciones(row as unknown as ViajeConVehiculosViaje),
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
      },
    });
    if (!row) throw new NotFoundException('Viaje no encontrado');
    return buildGananciaBrutaResumen(row);
  }

  async getExportaciones(id: string, tenantId: string) {
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: { id: true, numero: true, transportistaId: true },
    });
    if (!row) throw new NotFoundException('Viaje no encontrado');
    return buildViajeExportacionesResponse(row);
  }

  async create(tenantId: string, userId: string, dto: CreateViajeDto) {
    const transportistaExterno = dto.transportistaId?.trim();
    const vehiculoIds = transportistaExterno
      ? []
      : normalizarVehiculoIds(dto.vehiculoIds);
    assertViajeOperacionExclusiva({
      transportistaId: dto.transportistaId,
      choferId: dto.choferId,
      vehiculoIds,
    });
    const contratanteRealizaFlete =
      dto.contratanteRealizaFlete === true || dto.contratanteRealizaFlete === false
        ? dto.contratanteRealizaFlete
        : resolveContratanteRealizaFlete({
            flag: dto.contratanteRealizaFlete,
            transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
            hasTransportistaExterno: !!transportistaExterno,
          });
    const transportistaEfectivoId =
      dto.contratanteRealizaFlete === false
        ? (dto.transportistaEfectivoId ?? '').trim() || null
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
      transportistaId: transportistaExterno || null,
      choferId: transportistaExterno ? null : dto.choferId?.trim() || null,
      transportistaEfectivoId,
    };
    await this.assertRefs(tenantId, refs);
    if (!transportistaExterno) {
      await assertVehiculosDelViaje(this.prisma, tenantId, vehiculoIds, {
        requiereFlotaPropia: true,
      });
    }
    const productoItemsNorm = normalizarProductoItems(dto.productoItems);
    await assertProductosAsignables(this.prisma, tenantId, productoItemsNorm, {
      modo: 'create',
    });
    assertFechaDescargaValida(new Date(dto.fechaCarga), new Date(dto.fechaDescarga));
    const estado = this.parseEstadoViaje(dto.estado);
    if (esEstadoViajeFinal(estado)) {
      throw new BadRequestException(
        'Un viaje no puede crearse en un estado final',
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
        monedaMonto: dto.monedaMonto === 'USD' ? 'USD' : 'ARS',
        precioTransportistaExterno: precioTransportistaExterno ?? null,
        monedaPrecioTransportistaExterno:
          dto.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS',
        gananciaBrutaManual: gananciaPersist.gananciaBrutaManual,
        monedaGananciaBrutaManual: gananciaPersist.monedaGananciaBrutaManual,
        observaciones: dto.observaciones ?? null,
        otrosGastos: dto.otrosGastos ? (dto.otrosGastos as unknown as Prisma.InputJsonValue) : [],
        pagosTransportista: dto.pagosTransportista ? (dto.pagosTransportista as unknown as Prisma.InputJsonValue) : [],
        createdBy: userId,
      };
      const viaje = await tx.viaje.create({ data });
      await reemplazarVehiculosDelViaje(tx, viaje.id, vehiculoIds, tenantId);
      await reemplazarProductosDelViaje(tx, viaje.id, productoItemsNorm, tenantId);
      await reemplazarDestinosDelViaje(tx, viaje.id, destinosNorm, tenantId);
      const out = await tx.viaje.findFirstOrThrow({
        where: { id: viaje.id, tenantId },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      });
      return enrichViajeConGananciaBruta(
        out as unknown as ViajeConVehiculosViaje,
      ) as ViajeConVehiculosViaje;
    });
  }

  async update(id: string, tenantId: string, dto: UpdateViajeDto) {
    const current = await this.findOne(id, tenantId);
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
      dto.contratanteRealizaFlete === true || dto.contratanteRealizaFlete === false
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
        ? (dto.transportistaEfectivoId ?? '').trim() || null
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
      throw new BadRequestException('La fecha de carga es requerida');
    if (dto.fechaDescarga !== undefined && !dto.fechaDescarga)
      throw new BadRequestException('La fecha de descarga es requerida');
    const fcResolved = dto.fechaCarga ? new Date(dto.fechaCarga) : current.fechaCarga;
    const fdResolved = dto.fechaDescarga ? new Date(dto.fechaDescarga) : current.fechaDescarga;
    if (fcResolved && fdResolved) assertFechaDescargaValida(fcResolved, fdResolved);
    if (!op.transportistaId) {
      await assertVehiculosDelViaje(this.prisma, tenantId, op.vehiculoIds, {
        requiereFlotaPropia: true,
      });
    }

    if (dto.productoItems !== undefined) {
      const nextProductos = normalizarProductoItems(dto.productoItems);
      await assertProductosAsignables(this.prisma, tenantId, nextProductos, {
        modo: 'update',
        currentProductoIds: new Set(idsProductosDelViaje(current)),
      });
    }

    const precioTransportistaExternoInput = dto.precioTransportistaExterno;
    const currentNorm = this.parseEstadoViaje(
      current.estado != null && String(current.estado).trim() !== ''
        ? String(current.estado)
        : 'pendiente',
    );
    const estadoSiguiente =
      dto.estado != null && String(dto.estado).trim() !== ''
        ? this.parseEstadoViaje(String(dto.estado))
        : currentNorm;

    const data: Prisma.ViajeUpdateInput = {
      ...dto,
      monto:
        dto.monto !== undefined ? dto.monto : current.monto ?? undefined,
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
    delete (data as { contratanteRealizaFlete?: unknown }).contratanteRealizaFlete;
    delete (data as { transportistaEfectivoId?: unknown }).transportistaEfectivoId;
    if (dto.otrosGastos !== undefined) {
      (data as any).otrosGastos = dto.otrosGastos as unknown as Prisma.InputJsonValue;
    }
    if (dto.pagosTransportista !== undefined) {
      (data as any).pagosTransportista = dto.pagosTransportista as unknown as Prisma.InputJsonValue;
    }

    if (precioTransportistaExternoInput !== undefined) {
      (data as any).precioTransportistaExterno = precioTransportistaExternoInput;
    }
    if (dto.monedaMonto !== undefined) {
      (data as any).monedaMonto = dto.monedaMonto === 'USD' ? 'USD' : 'ARS';
    }
    if (dto.monedaPrecioTransportistaExterno !== undefined) {
      (data as any).monedaPrecioTransportistaExterno =
        dto.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS';
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
        monedaMonto: (data as { monedaMonto?: string }).monedaMonto ?? current.monedaMonto,
        monedaPrecioTransportistaExterno:
          (data as { monedaPrecioTransportistaExterno?: string })
            .monedaPrecioTransportistaExterno ?? current.monedaPrecioTransportistaExterno,
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
    delete (data as { monedaGananciaBrutaManual?: unknown }).monedaGananciaBrutaManual;
    (data as any).gananciaBrutaManual = gananciaPersist.gananciaBrutaManual;
    (data as any).monedaGananciaBrutaManual = gananciaPersist.monedaGananciaBrutaManual;

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
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      })) as unknown as ViajeConVehiculosViaje;
      if (esEstadoViajeFinal(full.estado)) {
        await this.upsertCargoFinalizacion(tx, full);
      }
      return enrichViajeConGananciaBruta(full) as ViajeConVehiculosViaje;
    });
  }

  async addGasto(id: string, tenantId: string, userId: string, dto: AddGastoDto) {
    const viaje = await this.findOne(id, tenantId);

    const ESTADOS_BLOQUEADOS = ['facturado_sin_cobrar', 'cobrado', 'cancelado'];
    if (ESTADOS_BLOQUEADOS.includes(viaje.estado)) {
      throw new BadRequestException(
        'No se pueden agregar gastos a un viaje facturado o cancelado.',
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
        data: { otrosGastos: gastosActualizados as unknown as Prisma.InputJsonValue },
      });

      const full = (await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      })) as unknown as ViajeConVehiculosViaje;

      if (esEstadoViajeFinal(full.estado)) {
        await this.upsertCargoFinalizacion(tx, full);
      }

      return full;
    });
  }

  async addPagoTransportista(id: string, tenantId: string, userId: string, dto: AddPagoTransportistaDto) {
    const viaje = await this.findOne(id, tenantId);

    if (viaje.estado === 'cancelado') {
      throw new BadRequestException('No se pueden registrar pagos en un viaje cancelado.');
    }
    if (!viaje.transportistaId) {
      throw new BadRequestException('Este viaje no tiene transportista externo asignado.');
    }

    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];

    const totalAcordado = viaje.precioTransportistaExterno ?? 0;
    const totalPagado = pagosActuales
      .filter((p) => p.moneda === dto.moneda)
      .reduce((acc, p) => acc + (typeof p.monto === 'number' ? p.monto : 0), 0);
    const saldo = totalAcordado - totalPagado;
    if (dto.monto > saldo) {
      throw new BadRequestException(
        'El monto ingresado supera el saldo pendiente con el transportista.',
      );
    }

    const nuevoPago: Record<string, unknown> = {
      monto: dto.monto,
      moneda: dto.moneda,
      fecha: dto.fecha,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
    if (dto.observaciones?.trim()) nuevoPago.observaciones = dto.observaciones.trim();
    if (dto.comprobante?.trim()) nuevoPago.comprobante = dto.comprobante.trim();

    const pagosActualizados = [...pagosActuales, nuevoPago];

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: { pagosTransportista: pagosActualizados as unknown as Prisma.InputJsonValue },
      });
      return (await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      })) as unknown as ViajeConVehiculosViaje;
    });
  }

  async deletePagoTransportista(id: string, tenantId: string, userId: string, index: number) {
    const viaje = await this.findOne(id, tenantId);

    if (viaje.estado === 'cancelado') {
      throw new BadRequestException('No se pueden eliminar pagos en un viaje cancelado.');
    }
    if (!viaje.transportistaId) {
      throw new BadRequestException('Este viaje no tiene transportista externo asignado.');
    }

    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];

    if (index < 0 || index >= pagosActuales.length) {
      throw new BadRequestException('Pago inválido.');
    }

    const pagosActualizados = pagosActuales.filter((_, idx) => idx !== index);

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: { pagosTransportista: pagosActualizados as unknown as Prisma.InputJsonValue },
      });
      return (await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      })) as unknown as ViajeConVehiculosViaje;
    });
  }

  async getViajesSaldoPendienteTransportista(tenantId: string) {
    const viajes = await this.prisma.viaje.findMany({
      where: { tenantId, transportistaId: { not: null }, precioTransportistaExterno: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      include: {
        cliente: { select: { id: true, nombre: true } },
        transportista: { select: { id: true, nombre: true } },
        factura: { select: { id: true, numero: true } },
      },
    });

    return viajes.filter((v) => {
      const moneda = v.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS';
      const acordado = v.precioTransportistaExterno ?? 0;
      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
        : [];
      const pagado = pagos
        .filter((p) => ((p.moneda ?? 'ARS') === 'USD' ? 'USD' : 'ARS') === moneda)
        .reduce((acc, p) => acc + (typeof p.monto === 'number' ? p.monto : 0), 0);
      return pagado < acordado;
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.viaje.delete({ where: { id } });
  }
}
