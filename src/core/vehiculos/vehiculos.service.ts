import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateVehiculoDto } from './dto/create-vehiculo.dto';
import { UpdateVehiculoDto } from './dto/update-vehiculo.dto';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

@Injectable()
export class VehiculosService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.vehiculo.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllPaginated(tenantId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.vehiculo.count({ where: { tenantId } }),
      this.prisma.vehiculo.findMany({
        where: { tenantId },
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
    const row = await this.prisma.vehiculo.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Vehículo no encontrado');
    return row;
  }

  private async assertTransportista(tenantId: string, transportistaId?: string) {
    if (!transportistaId) return;
    const t = await this.prisma.transportista.findFirst({
      where: { id: transportistaId, tenantId, tipo: 'externo' },
    });
    if (!t) {
      throw new BadRequestException('Transportista no pertenece al tenant');
    }
  }

  async create(tenantId: string, dto: CreateVehiculoDto) {
    await this.assertTransportista(tenantId, dto.transportistaId);
    return this.prisma.vehiculo.create({
      data: {
        tenantId,
        patente: dto.patente.toUpperCase(),
        tipo: dto.tipo,
        marca: dto.marca ?? null,
        modelo: dto.modelo ?? null,
        anio: dto.anio ?? null,
        kmActual: dto.kmActual ?? 0,
        transportistaId: dto.transportistaId ?? null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateVehiculoDto) {
    await this.findOne(id, tenantId);
    if (dto.transportistaId !== undefined) {
      await this.assertTransportista(tenantId, dto.transportistaId ?? undefined);
    }
    return this.prisma.vehiculo.update({
      where: { id },
      data: {
        ...dto,
        patente: dto.patente ? dto.patente.toUpperCase() : undefined,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.vehiculo.delete({ where: { id } });
  }
}
