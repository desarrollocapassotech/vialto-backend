import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreatePaisDto } from './dto/create-pais.dto';
import { UpdatePaisDto } from './dto/update-pais.dto';

@Injectable()
export class PaisesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.pais.findMany({
      where: { tenantId },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const row = await this.prisma.pais.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('País no encontrado');
    return row;
  }

  private async assertNombreDisponible(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ) {
    const existente = await this.prisma.pais.findFirst({
      where: {
        tenantId,
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existente) {
      throw new BadRequestException(
        `El país "${nombre}" ya existe en el listado.`,
      );
    }
  }

  async create(tenantId: string, dto: CreatePaisDto, userId?: string) {
    await this.assertNombreDisponible(tenantId, dto.nombre);

    return this.prisma.pais.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        codigo: dto.codigo ?? null,
        esPredefinido: false,
        createdBy: userId ?? null,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdatePaisDto) {
    const pais = await this.findOne(tenantId, id);

    if (pais.esPredefinido) {
      throw new BadRequestException(
        'Los países del sistema no se pueden editar.',
      );
    }

    if (dto.nombre) {
      await this.assertNombreDisponible(tenantId, dto.nombre, id);
    }

    return this.prisma.pais.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        codigo: dto.codigo,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const pais = await this.findOne(tenantId, id);

    if (pais.esPredefinido) {
      throw new BadRequestException(
        'Los países del sistema no se pueden eliminar.',
      );
    }

    return this.prisma.pais.delete({ where: { id } });
  }
}