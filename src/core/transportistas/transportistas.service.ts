import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTransportistaDto } from './dto/create-transportista.dto';
import { UpdateTransportistaDto } from './dto/update-transportista.dto';

@Injectable()
export class TransportistasService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.transportista.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
    return row;
  }

  create(tenantId: string, dto: CreateTransportistaDto) {
    return this.prisma.transportista.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        cuit: dto.cuit ?? null,
        email: dto.email ?? null,
        telefono: dto.telefono ?? null,
        tipo: 'externo',
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateTransportistaDto) {
    await this.findOne(id, tenantId);
    return this.prisma.transportista.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        cuit: dto.cuit,
        email: dto.email,
        telefono: dto.telefono,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.transportista.delete({ where: { id } });
  }
}
