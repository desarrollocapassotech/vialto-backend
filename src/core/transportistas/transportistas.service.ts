import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTransportistaDto } from './dto/create-transportista.dto';
import { UpdateTransportistaDto } from './dto/update-transportista.dto';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';
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

  async findAllPaginated(tenantId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.transportista.count({ where: { tenantId } }),
      this.prisma.transportista.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
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
    validarIdFiscal(dto.pais, dto.idFiscal);
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
    validarIdFiscal(next.pais, next.idFiscal);
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
