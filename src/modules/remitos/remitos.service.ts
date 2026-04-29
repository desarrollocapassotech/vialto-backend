import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { CreateRemitoDto } from './dto/create-remito.dto';
import { UpdateRemitoDto } from './dto/update-remito.dto';

@Injectable()
export class RemitosService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertRefs(
    tenantId: string,
    dto: { clienteId: string; choferId?: string | null; vehiculoId?: string | null },
  ) {
    const c = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, tenantId },
    });
    if (!c) throw new BadRequestException('Cliente inválido');
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

  findAll(tenantId: string, clienteId?: string) {
    return this.prisma.remito.findMany({
      where: { tenantId, ...(clienteId ? { clienteId } : {}) },
      orderBy: { fecha: 'desc' },
      take: 200,
    });
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.remito.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Remito no encontrado');
    return row;
  }

  async create(tenantId: string, dto: CreateRemitoDto) {
    await this.assertRefs(tenantId, dto);
    return this.prisma.remito.create({
      data: {
        tenantId,
        numero: dto.numero,
        clienteId: dto.clienteId,
        choferId: dto.choferId ?? null,
        vehiculoId: dto.vehiculoId ?? null,
        descripcion: dto.descripcion,
        fecha: new Date(dto.fecha),
        firmaUrl: dto.firmaUrl ?? null,
        estado: (dto.estado ?? 'emitido'),
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateRemitoDto) {
    const cur = await this.findOne(id, tenantId);
    await this.assertRefs(tenantId, {
      clienteId: dto.clienteId ?? cur.clienteId,
      choferId: dto.choferId !== undefined ? dto.choferId : cur.choferId,
      vehiculoId: dto.vehiculoId !== undefined ? dto.vehiculoId : cur.vehiculoId,
    });
    return this.prisma.remito.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...dto,
        fecha: dto.fecha === undefined ? undefined : new Date(dto.fecha),
      } as any,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.remito.delete({ where: { id } });
  }
}
