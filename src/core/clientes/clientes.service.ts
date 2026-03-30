import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.cliente.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.cliente.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Cliente no encontrado');
    return row;
  }

  create(tenantId: string, dto: CreateClienteDto) {
    return this.prisma.cliente.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        cuit: dto.cuit ?? null,
        email: dto.email ?? null,
        telefono: dto.telefono ?? null,
        direccion: dto.direccion ?? null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateClienteDto) {
    await this.findOne(id, tenantId);
    return this.prisma.cliente.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.cliente.delete({ where: { id } });
  }
}
