import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreatePaisDto } from './dto/create-pais.dto';

@Injectable()
export class PaisesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.pais.findMany({
      where: { tenantId },
      orderBy: { nombre: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreatePaisDto, userId?: string) {
    const existente = await this.prisma.pais.findFirst({
      where: {
        tenantId,
        nombre: { equals: dto.nombre, mode: 'insensitive' },
      },
    });

    if (existente) {
      throw new BadRequestException(
        `El país "${dto.nombre}" ya existe en el listado.`,
      );
    }

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
}