import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ViajesAutoEstadoService } from './viajes-auto-estado.service';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { CreateViajeDto } from './dto/create-viaje.dto';
import { generateNumeroViaje } from './generate-viaje-numero';
import { assertViajeOperacionExclusiva, mergeViajeOperacionIds } from './viaje-operacion-exclusiva';
import {
  assertVehiculosDelViaje,
  normalizarVehiculoIds,
  reemplazarVehiculosDelViaje,
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

function parseYyyyMmDdInicioUtc(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseYyyyMmDdFinUtc(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
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
  }) {
    const [c, t, ch] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
      dto.transportistaId
        ? this.prisma.transportista.findFirst({ where: { id: dto.transportistaId, tenantId } })
        : null,
      dto.choferId
        ? this.prisma.chofer.findFirst({ where: { id: dto.choferId, tenantId } })
        : null,
    ]);

    if (!c) throw new BadRequestException('Cliente inválido para este tenant');
    if (dto.transportistaId && !t) throw new BadRequestException('Transportista inválido');
    if (dto.choferId && !ch) throw new BadRequestException('Chofer inválido');
  }

  async findAll(tenantId: string, estado?: string) {
    return this.prisma.viaje.findMany({
      where: { tenantId, ...(estado ? { estado: estado } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        cliente:      { select: { id: true, nombre: true } },
        transportista: { select: { id: true, nombre: true } },
        factura:      { select: { id: true, numero: true } },
      },
    });
  }

  async getStats(tenantId: string) {
    const rows = await this.prisma.viaje.groupBy({
      by: ['estado'],
      where: { tenantId },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.estado, r._count._all]));
  }

  async findAllPaginated(tenantId: string, query: ViajesPaginatedQueryDto) {
    // Lazy update: sincroniza estados por fecha antes de devolver resultados
    await this.autoEstado.actualizarEstadosPorFecha(tenantId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.ViajeWhereInput = { tenantId };

    const est = query.estado?.trim();
    if (est) where.estado = est;

    const cid = query.clienteId?.trim();
    if (cid) where.clienteId = cid;

    const tid = query.transportistaId?.trim();
    if (tid) where.transportistaId = tid;

    const tipoFecha = query.tipoFecha?.trim();
    const fDesde = query.fechaDesde?.trim();
    const fHasta = query.fechaHasta?.trim();
    if (tipoFecha === 'carga' || tipoFecha === 'descarga') {
      const range: Prisma.DateTimeNullableFilter = {};
      if (fDesde) {
        const a = parseYyyyMmDdInicioUtc(fDesde);
        if (a) range.gte = a;
      }
      if (fHasta) {
        const b = parseYyyyMmDdFinUtc(fHasta);
        if (b) range.lte = b;
      }
      if (Object.keys(range).length > 0) {
        if (tipoFecha === 'carga') {
          where.fechaCarga = range;
        } else {
          where.fechaDescarga = range;
        }
      }
    }

    const tipoUbicacion = query.tipoUbicacion?.trim();
    const uq = query.ubicacion?.trim();
    if ((tipoUbicacion === 'origen' || tipoUbicacion === 'destino') && uq) {
      /**
       * El listado solo muestra el nombre de ciudad (antes de la primera coma); en BD puede
       * guardarse la etiqueta completa ("Ciudad, provincia") o solo la ciudad. El combobox
       * envía la etiqueta completa: OR entre contiene etiqueta, igual a solo ciudad, o
       * prefijo "Ciudad," para alinear con lo que el usuario ve y con datos viejos.
       */
      const campo = tipoUbicacion === 'origen' ? 'origen' : 'destino';
      const primeraComa = uq.indexOf(',');
      const soloCiudad =
        primeraComa === -1 ? uq : uq.slice(0, primeraComa).trim();
      const mode = Prisma.QueryMode.insensitive;

      const or: Prisma.ViajeWhereInput[] = [
        { [campo]: { startsWith: uq, mode } },
      ];
      if (soloCiudad.length >= 2 && soloCiudad !== uq) {
        or.push({ [campo]: { equals: soloCiudad, mode } });
        or.push({ [campo]: { startsWith: `${soloCiudad},`, mode } });
      }

      const prevAnd = where.AND;
      const andArr: Prisma.ViajeWhereInput[] = Array.isArray(prevAnd)
        ? [...prevAnd]
        : prevAnd != null
          ? [prevAnd]
          : [];
      where.AND = [...andArr, { OR: or }];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items,
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
    return row as unknown as ViajeConVehiculosViaje;
  }

  async create(tenantId: string, auth: AuthPayload, dto: CreateViajeDto) {
    const transportistaExterno = dto.transportistaId?.trim();
    const vehiculoIds = transportistaExterno
      ? []
      : normalizarVehiculoIds(dto.vehiculoIds);
    assertViajeOperacionExclusiva({
      transportistaId: dto.transportistaId,
      choferId: dto.choferId,
      vehiculoIds,
    });
    const refs = {
      clienteId: dto.clienteId,
      transportistaId: transportistaExterno || null,
      choferId: transportistaExterno ? null : dto.choferId?.trim() || null,
    };
    await this.assertRefs(tenantId, refs);
    if (!transportistaExterno) {
      await assertVehiculosDelViaje(this.prisma, tenantId, vehiculoIds, {
        requiereFlotaPropia: true,
      });
    }
    const estado = this.parseEstadoViaje(dto.estado);
    if (esEstadoViajeFinal(estado)) {
      throw new BadRequestException(
        'Un viaje no puede crearse en un estado final',
      );
    }
    const precioTransportistaExterno = dto.precioTransportistaExterno;
    const numero =
      dto.numero?.trim() || (await generateNumeroViaje(this.prisma, tenantId));

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.ViajeUncheckedCreateInput = {
        tenantId,
        numero,
        estado,
        clienteId: dto.clienteId,
        transportistaId: refs.transportistaId,
        choferId: refs.choferId,
        origen: dto.origen ?? null,
        destino: dto.destino ?? null,
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
        observaciones: dto.observaciones ?? null,
        otrosGastos: dto.otrosGastos ? (dto.otrosGastos as unknown as Prisma.InputJsonValue) : [],
        createdBy: auth.userId,
      };
      const viaje = await tx.viaje.create({ data });
      await reemplazarVehiculosDelViaje(tx, viaje.id, vehiculoIds, tenantId);
      const out = await tx.viaje.findFirstOrThrow({
        where: { id: viaje.id },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      });
      return out as unknown as ViajeConVehiculosViaje;
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
    const merged = {
      clienteId: dto.clienteId ?? current.clienteId,
      transportistaId: op.transportistaId,
      choferId: op.choferId,
    };
    await this.assertRefs(tenantId, merged);
    if (dto.fechaCarga !== undefined && !dto.fechaCarga)
      throw new BadRequestException('La fecha de carga es requerida');
    if (dto.fechaDescarga !== undefined && !dto.fechaDescarga)
      throw new BadRequestException('La fecha de descarga es requerida');
    if (!op.transportistaId) {
      await assertVehiculosDelViaje(this.prisma, tenantId, op.vehiculoIds, {
        requiereFlotaPropia: true,
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
    if (dto.otrosGastos !== undefined) {
      (data as any).otrosGastos = dto.otrosGastos as unknown as Prisma.InputJsonValue;
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
    (data as any).choferId = op.choferId;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.viaje.update({
        where: { id },
        data,
      });
      await reemplazarVehiculosDelViaje(tx, id, op.vehiculoIds, tenantId);
      const full = (await tx.viaje.findFirstOrThrow({
        where: { id },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      })) as unknown as ViajeConVehiculosViaje;
      if (esEstadoViajeFinal(full.estado)) {
        await this.upsertCargoFinalizacion(tx, full);
      }
      return full;
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.viaje.delete({ where: { id } });
  }
}
