import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateDireccionEntregaDto } from './dto/create-direccion-entrega.dto';
import { UpdateDireccionEntregaDto } from './dto/update-direccion-entrega.dto';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

function normalizeDireccion(direccion: string): string {
  return direccion.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class DireccionesEntregaService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertDireccionUnica(
    tenantId: string,
    direccion: string,
    excludeId?: string,
  ) {
    const normalized = normalizeDireccion(direccion);
    const existing = await this.prisma.direccionEntrega.findMany({
      where: { tenantId },
      select: { id: true, direccion: true },
    });
    const dup = existing.find(
      (row) =>
        row.id !== excludeId &&
        normalizeDireccion(row.direccion).localeCompare(normalized, 'es', {
          sensitivity: 'accent',
        }) === 0,
    );
    if (dup) {
      throw new ConflictException('Ya existe esa dirección o ruta de entrega.');
    }
  }

  async findAll(tenantId: string) {
    return this.prisma.direccionEntrega.findMany({
      where: { tenantId },
      orderBy: { direccion: 'asc' },
    });
  }

  async findAllPaginated(tenantId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.direccionEntrega.count({ where: { tenantId } }),
      this.prisma.direccionEntrega.findMany({
        where: { tenantId },
        orderBy: { direccion: 'asc' },
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
    const row = await this.prisma.direccionEntrega.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Dirección de entrega no encontrada');
    return row;
  }

  async create(tenantId: string, dto: CreateDireccionEntregaDto) {
    const direccion = normalizeDireccion(dto.direccion);
    await this.assertDireccionUnica(tenantId, direccion);
    return this.prisma.direccionEntrega.create({
      data: { tenantId, direccion },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateDireccionEntregaDto) {
    await this.findOne(id, tenantId);
    const direccion =
      dto.direccion === undefined ? undefined : normalizeDireccion(dto.direccion);
    if (direccion !== undefined) {
      await this.assertDireccionUnica(tenantId, direccion, id);
    }
    return this.prisma.direccionEntrega.update({
      where: { id },
      data: { direccion },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.direccionEntrega.delete({ where: { id } });
  }
}
