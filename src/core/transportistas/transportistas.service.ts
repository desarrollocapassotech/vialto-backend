import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTransportistaDto } from './dto/create-transportista.dto';
import { UpdateTransportistaDto } from './dto/update-transportista.dto';
import { validarIdFiscal } from '../../shared/util/validar-id-fiscal';

@Injectable()
export class TransportistasService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.transportista.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensureExists(id: string, tenantId: string) {
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId },
      select: { id: true, pais: true },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
    return row;
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
    return row;
  }

  create(tenantId: string, dto: CreateTransportistaDto) {
    validarIdFiscal(dto.pais, dto.idFiscal);
    return this.prisma.transportista.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        pais: dto.pais ?? null,
        idFiscal: dto.idFiscal ?? null,
        email: dto.email ?? null,
        telefono: dto.telefono ?? null,
        domicilio: dto.domicilio ?? null,
        condicionIva: dto.condicionIva ?? null,
        condicionTributaria: dto.condicionTributaria ?? null,
        paut: dto.paut ?? null,
        permisoInternacional: dto.permisoInternacional ?? null,
        fechaVencimientoPermiso: dto.fechaVencimientoPermiso ? new Date(dto.fechaVencimientoPermiso) : null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateTransportistaDto) {
    const existing = await this.ensureExists(id, tenantId);
    const paisEfectivo = dto.pais ?? existing.pais ?? undefined;
    validarIdFiscal(paisEfectivo, dto.idFiscal);
    return this.prisma.transportista.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        pais: dto.pais,
        idFiscal: dto.idFiscal,
        email: dto.email,
        telefono: dto.telefono,
        domicilio: dto.domicilio,
        condicionIva: dto.condicionIva,
        condicionTributaria: dto.condicionTributaria,
        paut: dto.paut,
        permisoInternacional: dto.permisoInternacional,
        fechaVencimientoPermiso:
          dto.fechaVencimientoPermiso === undefined
            ? undefined
            : dto.fechaVencimientoPermiso
              ? new Date(dto.fechaVencimientoPermiso)
              : null,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.ensureExists(id, tenantId);
    return this.prisma.transportista.delete({ where: { id } });
  }
}
