import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateChoferDto } from './dto/create-chofer.dto';
import { UpdateChoferDto } from './dto/update-chofer.dto';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';
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

  async findAllPaginated(tenantId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.chofer.count({ where: { tenantId } }),
      this.prisma.chofer.findMany({
        where: { tenantId },
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

  async create(tenantId: string, dto: CreateChoferDto) {
    await this.assertTransportista(tenantId, dto.transportistaId);
    const row = await this.prisma.chofer.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        dni: dto.dni ?? null,
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
      },
    });
    return sanitize(row);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.chofer.delete({ where: { id } });
  }
}
