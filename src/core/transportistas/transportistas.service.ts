import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTransportistaDto } from './dto/create-transportista.dto';
import { UpdateTransportistaDto } from './dto/update-transportista.dto';

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
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
    return row;
  }

  private assertTransportistaRequiredFields(data: {
    nombre: string;
    pais: string | null | undefined;
    idFiscal: string | null | undefined;
  }) {
    if (!data.nombre?.trim()) {
      throw new BadRequestException('El nombre es obligatorio');
    }
    if (!data.pais?.trim()) {
      throw new BadRequestException('El país es obligatorio');
    }
    if (!data.idFiscal?.trim()) {
      throw new BadRequestException('El ID Fiscal es obligatorio');
    }
  }

  create(tenantId: string, dto: CreateTransportistaDto) {
    this.assertTransportistaRequiredFields(dto);
    return this.prisma.transportista.create({
      data: {
        tenantId,
        nombre: dto.nombre.trim(),
        pais: dto.pais.trim(),
        idFiscal: dto.idFiscal.trim(),
        email: dto.email?.trim() || null,
        telefono: dto.telefono?.trim() || null,
        domicilio: dto.domicilio?.trim() || null,
        condicionIva: dto.condicionIva ?? null,
        condicionTributaria: dto.condicionTributaria?.trim() || null,
        paut: dto.paut?.trim() || null,
        permisoInternacional: dto.permisoInternacional?.trim() || null,
        fechaVencimientoPermiso: dto.fechaVencimientoPermiso
          ? new Date(dto.fechaVencimientoPermiso)
          : null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateTransportistaDto) {
    const current = await this.findOne(id, tenantId);
    const next = {
      nombre: dto.nombre !== undefined ? dto.nombre.trim() : current.nombre,
      pais: dto.pais !== undefined ? dto.pais.trim() : (current.pais ?? ''),
      idFiscal:
        dto.idFiscal !== undefined ? dto.idFiscal.trim() : (current.idFiscal ?? ''),
      email: dto.email !== undefined ? dto.email?.trim() || null : current.email,
      telefono: dto.telefono !== undefined ? dto.telefono?.trim() || null : current.telefono,
      domicilio:
        dto.domicilio !== undefined ? dto.domicilio?.trim() || null : current.domicilio,
      condicionIva:
        dto.condicionIva !== undefined ? dto.condicionIva : current.condicionIva,
      condicionTributaria:
        dto.condicionTributaria !== undefined
          ? dto.condicionTributaria?.trim() || null
          : current.condicionTributaria,
      paut: dto.paut !== undefined ? dto.paut?.trim() || null : current.paut,
      permisoInternacional:
        dto.permisoInternacional !== undefined
          ? dto.permisoInternacional?.trim() || null
          : current.permisoInternacional,
      fechaVencimientoPermiso:
        dto.fechaVencimientoPermiso === undefined
          ? current.fechaVencimientoPermiso
          : dto.fechaVencimientoPermiso
            ? new Date(dto.fechaVencimientoPermiso)
            : null,
    };
    this.assertTransportistaRequiredFields(next);
    return this.prisma.transportista.update({
      where: { id },
      data: next,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.ensureExists(id, tenantId);
    return this.prisma.transportista.delete({ where: { id } });
  }
}
