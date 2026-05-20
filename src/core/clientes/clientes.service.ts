import { Injectable, NotFoundException } from '@nestjs/common';
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

  create(tenantId: string, dto: CreateClienteDto) {
    validarIdFiscal(dto.pais, dto.idFiscal);
    return this.prisma.cliente.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        idFiscal: dto.idFiscal ?? null,
        email: dto.email ?? null,
        telefono: dto.telefono ?? null,
        direccion: dto.direccion ?? null,
        pais: dto.pais ?? null,
        condicionIva: dto.pais === 'AR' ? (dto.condicionIva ?? null) : null,
        condicionTributaria: dto.pais !== 'AR' ? (dto.condicionTributaria ?? null) : null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateClienteDto) {
    const existing = await this.findOne(id, tenantId);
    const paisEfectivo = dto.pais ?? existing.pais ?? undefined;
    validarIdFiscal(paisEfectivo, dto.idFiscal);
    return this.prisma.cliente.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        idFiscal: dto.idFiscal,
        email: dto.email,
        telefono: dto.telefono,
        direccion: dto.direccion,
        pais: dto.pais,
        condicionIva: paisEfectivo === 'AR' ? dto.condicionIva : null,
        condicionTributaria: paisEfectivo !== 'AR' ? dto.condicionTributaria : null,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.cliente.delete({ where: { id } });
  }
}
