import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateIntervencionDto } from './dto/create-intervencion.dto';
import { UpdateIntervencionDto } from './dto/update-intervencion.dto';

@Injectable()
export class MantenimientoService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertVehiculo(tenantId: string, vehiculoId: string) {
    const v = await this.prisma.vehiculo.findFirst({
      where: { id: vehiculoId, tenantId },
    });
    if (!v) throw new BadRequestException('Vehículo inválido');
  }

  findAll(tenantId: string, vehiculoId?: string) {
    return this.prisma.intervencion.findMany({
      where: { tenantId, ...(vehiculoId ? { vehiculoId } : {}) },
      orderBy: { fecha: 'desc' },
      take: 300,
    });
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.intervencion.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Intervención no encontrada');
    return row;
  }

  async create(tenantId: string, dto: CreateIntervencionDto) {
    await this.assertVehiculo(tenantId, dto.vehiculoId);
    return this.prisma.intervencion.create({
      data: {
        tenantId,
        vehiculoId: dto.vehiculoId,
        tipo: dto.tipo,
        descripcion: dto.descripcion ?? null,
        km: dto.km ?? null,
        proximoKm: dto.proximoKm ?? null,
        fecha: new Date(dto.fecha),
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateIntervencionDto) {
    const cur = await this.findOne(id, tenantId);
    const vid = dto.vehiculoId ?? cur.vehiculoId;
    await this.assertVehiculo(tenantId, vid);
    return this.prisma.intervencion.update({
      where: { id },
      data: {
        ...dto,
        fecha: dto.fecha === undefined ? undefined : new Date(dto.fecha),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.intervencion.delete({ where: { id } });
  }
}
