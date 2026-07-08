import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateDestinatarioDto } from './dto/create-destinatario.dto';
import { UpdateDestinatarioDto } from './dto/update-destinatario.dto';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

function normalizeNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class DestinatariosService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ) {
    const normalized = normalizeNombre(nombre);
    const existing = await this.prisma.destinatario.findMany({
      where: { tenantId },
      select: { id: true, nombre: true },
    });
    const dup = existing.find(
      (row) =>
        row.id !== excludeId &&
        normalizeNombre(row.nombre).localeCompare(normalized, 'es', {
          sensitivity: 'accent',
        }) === 0,
    );
    if (dup) {
      throw new ConflictException('Ya existe un destinatario con ese nombre.');
    }
  }

  async findAll(tenantId: string) {
    return this.prisma.destinatario.findMany({
      where: { tenantId },
      orderBy: { nombre: 'asc' },
    });
  }

  async findAllPaginated(tenantId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.destinatario.count({ where: { tenantId } }),
      this.prisma.destinatario.findMany({
        where: { tenantId },
        orderBy: { nombre: 'asc' },
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
    const row = await this.prisma.destinatario.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Destinatario no encontrado');
    return row;
  }

  async create(tenantId: string, dto: CreateDestinatarioDto) {
    const nombre = normalizeNombre(dto.nombre);
    await this.assertNombreUnico(tenantId, nombre);
    return this.prisma.destinatario.create({
      data: { tenantId, nombre },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateDestinatarioDto) {
    await this.findOne(id, tenantId);
    const nombre =
      dto.nombre === undefined ? undefined : normalizeNombre(dto.nombre);
    if (nombre !== undefined) {
      await this.assertNombreUnico(tenantId, nombre, id);
    }
    return this.prisma.destinatario.update({
      where: { id },
      data: { nombre },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.destinatario.delete({ where: { id } });
  }
}
