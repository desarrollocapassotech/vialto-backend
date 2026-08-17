import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';
import { validarIdFiscal } from '../../shared/util/validar-id-fiscal';

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.cliente.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllPaginated(tenantId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.cliente.count({ where: { tenantId } }),
      this.prisma.cliente.findMany({
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

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.cliente.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Cliente no encontrado');
    return row;
  }

  private assertClienteRequiredFields(
    data: {
      nombre: string;
      idFiscal?: string | null;
      pais?: string | null;
    },
    confirmarSinDatosFiscales?: boolean,
  ) {
    if (!data.nombre?.trim()) {
      throw new BadRequestException('El nombre es obligatorio');
    }
    // ID Fiscal y país son recomendados (los necesita Facturación más
    // adelante), no obligatorios — si faltan, hace falta que el usuario lo
    // confirme explícitamente antes de guardar.
    if ((!data.idFiscal?.trim() || !data.pais?.trim()) && !confirmarSinDatosFiscales) {
      throw new BadRequestException(
        'Falta el ID Fiscal y/o el país — confirmá que querés guardar igual sin esos datos.',
      );
    }
  }

  create(tenantId: string, dto: CreateClienteDto) {
    this.assertClienteRequiredFields(dto, dto.confirmarSinDatosFiscales);
    const pais = dto.pais?.trim() || null;
    const idFiscal = dto.idFiscal?.trim() || null;
    validarIdFiscal(pais, idFiscal);
    return this.prisma.cliente.create({
      data: {
        tenantId,
        nombre: dto.nombre.trim(),
        idFiscal,
        pais,
        email: dto.email?.trim() || null,
        telefono: dto.telefono?.trim() || null,
        direccion: dto.direccion?.trim() || null,
        condicionIva: pais === 'AR' ? (dto.condicionIva ?? null) : null,
        condicionTributaria: pais !== 'AR' ? (dto.condicionTributaria ?? null) : null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateClienteDto) {
    const current = await this.findOne(id, tenantId);
    const paisEfectivo =
      dto.pais !== undefined ? dto.pais.trim() : (current.pais ?? '');
    const idFiscalEfectivo =
      dto.idFiscal !== undefined ? dto.idFiscal.trim() : (current.idFiscal ?? '');
    const next = {
      nombre: dto.nombre !== undefined ? dto.nombre.trim() : current.nombre,
      idFiscal: idFiscalEfectivo || null,
      pais: paisEfectivo || null,
      email: dto.email !== undefined ? dto.email?.trim() || null : current.email,
      telefono: dto.telefono !== undefined ? dto.telefono?.trim() || null : current.telefono,
      direccion:
        dto.direccion !== undefined ? dto.direccion?.trim() || null : current.direccion,
    };
    this.assertClienteRequiredFields(next, dto.confirmarSinDatosFiscales);
    validarIdFiscal(next.pais, next.idFiscal);
    return this.prisma.cliente.update({
      where: { id },
      data: {
        nombre: next.nombre,
        idFiscal: next.idFiscal,
        pais: next.pais,
        email: next.email,
        telefono: next.telefono,
        direccion: next.direccion,
        condicionIva: next.pais === 'AR' ? dto.condicionIva : null,
        condicionTributaria: next.pais !== 'AR' ? dto.condicionTributaria : null,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.cliente.delete({ where: { id } });
  }
}
