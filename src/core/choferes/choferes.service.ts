import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateChoferDto } from './dto/create-chofer.dto';
import { UpdateChoferDto } from './dto/update-chofer.dto';
import { ChoferesPaginatedQueryDto } from './dto/choferes-paginated-query.dto';
import { hashPin } from '../../shared/util/pin-hash';

/** Nunca devolver el hash del PIN en respuestas de API; exponer solo si está configurado. */
function sanitize<T extends { pin?: string | null }>(
  chofer: T,
): Omit<T, 'pin'> & { pinConfigured: boolean } {
  const { pin, ...rest } = chofer;
  return { ...rest, pinConfigured: !!pin };
}

@Injectable()
export class ChoferesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    const rows = await this.prisma.chofer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(sanitize);
  }

  async findAllPaginated(tenantId: string, query: ChoferesPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.ChoferWhereInput = { tenantId };

    const nombre = query.nombre?.trim();
    if (nombre) where.nombre = { contains: nombre, mode: 'insensitive' };

    const dni = query.dni?.trim();
    if (dni) where.dni = { contains: dni, mode: 'insensitive' };

    const filtroActivo = query.filtroActivo ?? 'todos';
    if (filtroActivo === 'activos') where.activo = true;
    else if (filtroActivo === 'inactivos') where.activo = false;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.chofer.count({ where }),
      this.prisma.chofer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map(sanitize),
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
    const row = await this.prisma.chofer.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Chofer no encontrado');
    return sanitize(row);
  }

  private async assertTransportista(tenantId: string, transportistaId?: string) {
    if (!transportistaId) return;
    const t = await this.prisma.transportista.findFirst({
      where: { id: transportistaId, tenantId },
    });
    if (!t) {
      throw new BadRequestException('Transportista no pertenece al tenant');
    }
  }

  private async assertDniDisponible(
    tenantId: string,
    dni: string | null,
    excludeId?: string,
  ) {
    if (!dni) return;
    const existente = await this.prisma.chofer.findFirst({
      where: { tenantId, dni, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException('Ya existe un chofer con ese DNI');
    }
  }

  async create(tenantId: string, dto: CreateChoferDto) {
    await this.assertTransportista(tenantId, dto.transportistaId);
    const dni = dto.dni ?? null;
    await this.assertDniDisponible(tenantId, dni);
    const row = await this.prisma.chofer.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        dni,
        cuit: dto.cuit?.trim() || null,
        licencia: dto.licencia ?? null,
        licenciaVence: dto.licenciaVence ? new Date(dto.licenciaVence) : null,
        telefono: dto.telefono ?? null,
        transportistaId: dto.transportistaId ?? null,
        pin: dto.pin ? hashPin(dto.pin) : null,
      },
    });
    return sanitize(row);
  }

  async update(id: string, tenantId: string, dto: UpdateChoferDto) {
    await this.findOne(id, tenantId);
    if (dto.transportistaId !== undefined) {
      await this.assertTransportista(tenantId, dto.transportistaId ?? undefined);
    }
    if (dto.dni !== undefined) {
      await this.assertDniDisponible(tenantId, dto.dni ?? null, id);
    }
    const row = await this.prisma.chofer.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        dni: dto.dni,
        cuit: dto.cuit === undefined ? undefined : dto.cuit?.trim() || null,
        licencia: dto.licencia,
        telefono: dto.telefono,
        transportistaId:
          dto.transportistaId === undefined ? undefined : dto.transportistaId,
        licenciaVence:
          dto.licenciaVence === undefined
            ? undefined
            : dto.licenciaVence
              ? new Date(dto.licenciaVence)
              : null,
        pin: dto.pin === undefined ? undefined : hashPin(dto.pin),
        activo: dto.activo,
      },
    });
    return sanitize(row);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.chofer.delete({ where: { id } });
  }
}
