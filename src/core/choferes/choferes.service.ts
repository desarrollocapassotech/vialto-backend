import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateChoferDto } from './dto/create-chofer.dto';
import { UpdateChoferDto } from './dto/update-chofer.dto';

@Injectable()
export class ChoferesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.chofer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.chofer.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Chofer no encontrado');
    return row;
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
    return this.prisma.chofer.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        dni: dto.dni ?? null,
        licencia: dto.licencia ?? null,
        licenciaVence: dto.licenciaVence ? new Date(dto.licenciaVence) : null,
        telefono: dto.telefono ?? null,
        transportistaId: dto.transportistaId ?? null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateChoferDto) {
    await this.findOne(id, tenantId);
    if (dto.transportistaId !== undefined) {
      await this.assertTransportista(tenantId, dto.transportistaId ?? undefined);
    }
    return this.prisma.chofer.update({
      where: { id },
      data: {
        ...dto,
        licenciaVence:
          dto.licenciaVence === undefined
            ? undefined
            : dto.licenciaVence
              ? new Date(dto.licenciaVence)
              : null,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.chofer.delete({ where: { id } });
  }
}
