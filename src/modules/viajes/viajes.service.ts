import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { CreateViajeDto } from './dto/create-viaje.dto';
import { UpdateViajeDto } from './dto/update-viaje.dto';

function calcGanancia(precioCliente?: number | null, precioFletero?: number | null) {
  if (precioCliente == null || precioFletero == null) return null;
  return precioCliente - precioFletero;
}

@Injectable()
export class ViajesService {
  constructor(private readonly prisma: PrismaService) {}

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
        where: { id: dto.transportistaId, tenantId },
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

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.viaje.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Viaje no encontrado');
    return row;
  }

  async create(tenantId: string, auth: AuthPayload, dto: CreateViajeDto) {
    await this.assertRefs(tenantId, dto);
    const gananciaBruta = calcGanancia(dto.precioCliente, dto.precioFletero);
    return this.prisma.viaje.create({
      data: {
        tenantId,
        numero: dto.numero,
        estado: dto.estado ?? 'pendiente',
        clienteId: dto.clienteId,
        transportistaId: dto.transportistaId ?? null,
        choferId: dto.choferId ?? null,
        vehiculoId: dto.vehiculoId ?? null,
        origen: dto.origen ?? null,
        destino: dto.destino ?? null,
        fechaSalida: dto.fechaSalida ? new Date(dto.fechaSalida) : null,
        fechaLlegada: dto.fechaLlegada ? new Date(dto.fechaLlegada) : null,
        mercaderia: dto.mercaderia ?? null,
        kmRecorridos: dto.kmRecorridos ?? null,
        litrosConsumidos: dto.litrosConsumidos ?? null,
        precioCliente: dto.precioCliente ?? null,
        precioFletero: dto.precioFletero ?? null,
        gananciaBruta,
        documentacion: dto.documentacion ?? [],
        observaciones: dto.observaciones ?? null,
        createdBy: auth.userId,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateViajeDto) {
    const current = await this.findOne(id, tenantId);
    const merged = {
      clienteId: dto.clienteId ?? current.clienteId,
      transportistaId:
        dto.transportistaId !== undefined
          ? dto.transportistaId
          : current.transportistaId,
      choferId:
        dto.choferId !== undefined ? dto.choferId : current.choferId,
      vehiculoId:
        dto.vehiculoId !== undefined ? dto.vehiculoId : current.vehiculoId,
    };
    await this.assertRefs(tenantId, merged);

    const precioCliente =
      dto.precioCliente !== undefined ? dto.precioCliente : current.precioCliente;
    const precioFletero =
      dto.precioFletero !== undefined ? dto.precioFletero : current.precioFletero;
    const gananciaBruta = calcGanancia(precioCliente, precioFletero);

    return this.prisma.viaje.update({
      where: { id },
      data: {
        ...dto,
        fechaSalida:
          dto.fechaSalida === undefined
            ? undefined
            : dto.fechaSalida
              ? new Date(dto.fechaSalida)
              : null,
        fechaLlegada:
          dto.fechaLlegada === undefined
            ? undefined
            : dto.fechaLlegada
              ? new Date(dto.fechaLlegada)
              : null,
        gananciaBruta,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.viaje.delete({ where: { id } });
  }
}
