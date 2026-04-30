import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateCargaDto } from './dto/create-carga.dto';
import { UpdateCargaDto } from './dto/update-carga.dto';
import { CargasPaginatedQueryDto } from './dto/cargas-paginated-query.dto';
import { nombreCargaDisplay, normalizarNombreCarga } from '../../shared/util/carga-viaje';

const publicSelect = {
  id: true,
  tenantId: true,
  nombre: true,
  descripcion: true,
  unidadMedida: true,
  activo: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CargaPublic = {
  id: string;
  tenantId: string;
  nombre: string;
  descripcion: string | null;
  unidadMedida: string | null;
  activo: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class CargasService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(tenantId: string, query: CargasPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.CargaWhereInput = { tenantId };

    const q = query.q?.trim();
    if (q) {
      where.nombre = { contains: q, mode: 'insensitive' };
    }

    const fa = query.filtroActivo ?? 'todos';
    if (fa === 'activos') where.activo = true;
    else if (fa === 'inactivos') where.activo = false;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.carga.count({ where }),
      this.prisma.carga.findMany({
        where,
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: publicSelect,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: rows as CargaPublic[],
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

  async findOne(id: string, tenantId: string): Promise<CargaPublic> {
    const row = await this.prisma.carga.findFirst({
      where: { id, tenantId },
      select: publicSelect,
    });
    if (!row) throw new NotFoundException('Carga no encontrada');
    return row as CargaPublic;
  }

  async create(tenantId: string, dto: CreateCargaDto): Promise<CargaPublic> {
    const nombre = nombreCargaDisplay(dto.nombre);
    if (!nombre) {
      throw new ConflictException('El nombre no puede quedar vacío.');
    }
    const nombreNormalizado = normalizarNombreCarga(nombre);
    try {
      const row = await this.prisma.carga.create({
        data: {
          tenantId,
          nombre,
          nombreNormalizado,
          descripcion: dto.descripcion?.trim() || null,
          unidadMedida: dto.unidadMedida?.trim() || null,
        },
        select: publicSelect,
      });
      return row as CargaPublic;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una carga con ese nombre (sin distinguir mayúsculas).');
      }
      throw e;
    }
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateCargaDto,
  ): Promise<CargaPublic> {
    const current = await this.prisma.carga.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException('Carga no encontrada');

    const nombre =
      dto.nombre !== undefined ? nombreCargaDisplay(dto.nombre) : current.nombre;
    if (dto.nombre !== undefined && !nombre) {
      throw new ConflictException('El nombre no puede quedar vacío.');
    }
    const nombreNormalizado =
      dto.nombre !== undefined
        ? normalizarNombreCarga(nombre)
        : current.nombreNormalizado;

    try {
      const row = await this.prisma.carga.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre, nombreNormalizado } : {}),
          ...(dto.descripcion !== undefined
            ? { descripcion: dto.descripcion?.trim() || null }
            : {}),
          ...(dto.unidadMedida !== undefined
            ? { unidadMedida: dto.unidadMedida?.trim() || null }
            : {}),
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        },
        select: publicSelect,
      });
      return row as CargaPublic;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una carga con ese nombre (sin distinguir mayúsculas).');
      }
      throw e;
    }
  }
}
