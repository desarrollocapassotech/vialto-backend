import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
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
import { Prisma } from '@prisma/client';
import {
  VIAJE_ESTADOS_SET,
  esEstadoViajeFinal,
  normalizarEstadoViaje,
  type ViajeEstado,
} from './viaje-estados';

@Injectable()
export class ViajesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Acepta legado `finalizado` y valida contra {@link VIAJE_ESTADOS}. */
  private parseEstadoViaje(estado: string): ViajeEstado {
    const n = normalizarEstadoViaje(estado);
    if (!VIAJE_ESTADOS_SET.has(n)) {
      throw new BadRequestException('Estado de viaje inválido');
    }
    return n as ViajeEstado;
  }

  private getMontoFinal(viaje: { monto: number | null }) {
    const monto = viaje.monto;
    if (monto == null || monto <= 0) {
      throw new BadRequestException(
        'Para finalizar un viaje se requiere un monto mayor a 0',
      );
    }
    return monto;
  }

  private async upsertCargoFinalizacion(
    tx: Prisma.TransactionClient,
    viaje: {
      id: string;
      tenantId: string;
      clienteId: string;
      numero: string;
      monto: number | null;
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
    const c = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, tenantId },
    });
    if (!c) throw new BadRequestException('Cliente inválido para este tenant');

    if (dto.transportistaId) {
      const t = await this.prisma.transportista.findFirst({
        where: { id: dto.transportistaId, tenantId, tipo: 'externo' },
      });
      if (!t) throw new BadRequestException('Transportista inválido');
    }
    if (dto.choferId) {
      const ch = await this.prisma.chofer.findFirst({
        where: { id: dto.choferId, tenantId },
      });
      if (!ch) throw new BadRequestException('Chofer inválido');
    }
  }

  /**
   * Corrige viajes con factura asignada pero estado incorrecto.
   * Ejecuta un updateMany y muta el array en memoria para no releer BD.
   */
  private async corregirEstadosConFactura(
    viajes: Array<{ id: string; facturaId: string | null; estado: string }>,
  ) {
    const aCorregir = viajes.filter(
      (v) =>
        v.facturaId != null &&
        v.estado !== 'facturado_sin_cobrar' &&
        v.estado !== 'cobrado',
    );
    if (aCorregir.length === 0) return;
    await this.prisma.viaje.updateMany({
      where: { id: { in: aCorregir.map((v) => v.id) } },
      data: { estado: 'facturado_sin_cobrar' },
    });
    aCorregir.forEach((v) => {
      v.estado = 'facturado_sin_cobrar';
    });
  }

  async findAll(tenantId: string, estado?: string) {
    const rows = await this.prisma.viaje.findMany({
      where: { tenantId, ...(estado ? { estado } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
    });
    await this.corregirEstadosConFactura(rows);
    return rows;
  }

  async findAllPaginated(tenantId: string, query: ViajesPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.ViajeWhereInput = { tenantId };

    const est = query.estado?.trim();
    if (est) where.estado = est;

    const cid = query.clienteId?.trim();
    if (cid) where.clienteId = cid;

    const tid = query.transportistaId?.trim();
    if (tid) where.transportistaId = tid;

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
    await this.corregirEstadosConFactura(items);
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
        fechaCarga: dto.fechaCarga ? new Date(dto.fechaCarga) : null,
        fechaDescarga: dto.fechaDescarga ? new Date(dto.fechaDescarga) : null,
        detalleCarga: dto.detalleCarga ?? null,
        kmRecorridos: dto.kmRecorridos ?? null,
        litrosConsumidos: dto.litrosConsumidos ?? null,
        monto: dto.monto,
        monedaMonto: dto.monedaMonto === 'USD' ? 'USD' : 'ARS',
        precioTransportistaExterno: precioTransportistaExterno ?? null,
        monedaPrecioTransportistaExterno:
          dto.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS',
        observaciones: dto.observaciones ?? null,
        createdBy: auth.userId,
      };
      const viaje = await tx.viaje.create({ data });
      await reemplazarVehiculosDelViaje(tx, viaje.id, vehiculoIds);
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
      await reemplazarVehiculosDelViaje(tx, id, op.vehiculoIds);
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
