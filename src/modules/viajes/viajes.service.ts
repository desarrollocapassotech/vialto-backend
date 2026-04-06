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
import { UpdateViajeDto } from './dto/update-viaje.dto';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';
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
    vehiculoId?: string | null;
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
    if (dto.vehiculoId) {
      const v = await this.prisma.vehiculo.findFirst({
        where: { id: dto.vehiculoId, tenantId },
      });
      if (!v) throw new BadRequestException('Vehículo inválido');
    }
  }

  findAll(tenantId: string, estado?: string) {
    return this.prisma.viaje.findMany({
      where: { tenantId, ...(estado ? { estado } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async findAllPaginated(tenantId: string, query: PaginationQueryDto, estado?: string) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = { tenantId, ...(estado ? { estado } : {}) };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
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

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.viaje.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Viaje no encontrado');
    return row;
  }

  async create(tenantId: string, auth: AuthPayload, dto: CreateViajeDto) {
    assertViajeOperacionExclusiva({
      transportistaId: dto.transportistaId,
      choferId: dto.choferId,
      vehiculoId: dto.vehiculoId,
    });
    const transportistaExterno = dto.transportistaId?.trim();
    const refs = {
      clienteId: dto.clienteId,
      transportistaId: transportistaExterno || null,
      choferId: transportistaExterno ? null : dto.choferId?.trim() || null,
      vehiculoId: transportistaExterno ? null : dto.vehiculoId?.trim() || null,
    };
    await this.assertRefs(tenantId, refs);
    const estado = this.parseEstadoViaje(dto.estado);
    if (esEstadoViajeFinal(estado)) {
      throw new BadRequestException(
        'Un viaje no puede crearse en un estado final',
      );
    }
    const precioTransportistaExterno = dto.precioTransportistaExterno;
    const numero =
      dto.numero?.trim() || (await generateNumeroViaje(this.prisma, tenantId));
    return this.prisma.viaje.create({
      data: {
        tenantId,
        numero,
        estado,
        clienteId: dto.clienteId,
        transportistaId: refs.transportistaId,
        choferId: refs.choferId,
        vehiculoId: refs.vehiculoId,
        patenteTractor: dto.patenteTractor?.trim()
          ? dto.patenteTractor.trim().toUpperCase()
          : null,
        patenteSemirremolque: dto.patenteSemirremolque?.trim()
          ? dto.patenteSemirremolque.trim().toUpperCase()
          : null,
        origen: dto.origen ?? null,
        destino: dto.destino ?? null,
        fechaCarga: dto.fechaCarga ? new Date(dto.fechaCarga) : null,
        fechaDescarga: dto.fechaDescarga ? new Date(dto.fechaDescarga) : null,
        mercaderia: dto.mercaderia ?? null,
        kmRecorridos: dto.kmRecorridos ?? null,
        litrosConsumidos: dto.litrosConsumidos ?? null,
        monto: dto.monto,
        precioTransportistaExterno: precioTransportistaExterno ?? null,
        documentacion: dto.documentacion ?? [],
        observaciones: dto.observaciones ?? null,
        createdBy: auth.userId,
      } as any,
    });
  }

  async update(id: string, tenantId: string, dto: UpdateViajeDto) {
    const current = await this.findOne(id, tenantId);
    const op = mergeViajeOperacionIds(
      {
        transportistaId: current.transportistaId,
        choferId: current.choferId,
        vehiculoId: current.vehiculoId,
      },
      dto,
    );
    const merged = {
      clienteId: dto.clienteId ?? current.clienteId,
      transportistaId: op.transportistaId,
      choferId: op.choferId,
      vehiculoId: op.vehiculoId,
    };
    await this.assertRefs(tenantId, merged);

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
      patenteTractor:
        dto.patenteTractor === undefined
          ? undefined
          : dto.patenteTractor.trim().toUpperCase(),
      patenteSemirremolque:
        dto.patenteSemirremolque === undefined
          ? undefined
          : dto.patenteSemirremolque.trim().toUpperCase(),
    } as any;
    if (precioTransportistaExternoInput !== undefined) {
      (data as any).precioTransportistaExterno = precioTransportistaExternoInput;
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
    (data as any).vehiculoId = op.vehiculoId;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.viaje.update({
        where: { id },
        data,
      });
      if (esEstadoViajeFinal(updated.estado)) {
        await this.upsertCargoFinalizacion(tx, updated);
      }
      return updated;
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.viaje.delete({ where: { id } });
  }
}
