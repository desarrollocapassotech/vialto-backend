import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateMovimientoCcDto } from './dto/create-movimiento-cc.dto';
import { UpdateMovimientoCcDto } from './dto/update-movimiento-cc.dto';

@Injectable()
export class CuentaCorrienteService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCliente(tenantId: string, clienteId: string) {
    const c = await this.prisma.cliente.findFirst({
      where: { id: clienteId, tenantId },
    });
    if (!c) throw new BadRequestException('Cliente inválido');
  }

  findAll(tenantId: string, clienteId?: string) {
    return this.prisma.movimientoCuentaCorriente.findMany({
      where: { tenantId, ...(clienteId ? { clienteId } : {}) },
      orderBy: { fecha: 'desc' },
      take: 500,
    });
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.movimientoCuentaCorriente.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    return row;
  }

  async create(tenantId: string, dto: CreateMovimientoCcDto) {
    await this.assertCliente(tenantId, dto.clienteId);
    return this.prisma.movimientoCuentaCorriente.create({
      data: {
        tenantId,
        clienteId: dto.clienteId,
        tipo: dto.tipo,
        concepto: dto.concepto,
        importe: dto.importe,
        saldoPost: dto.saldoPost,
        fecha: new Date(dto.fecha),
        referencia: dto.referencia ?? null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateMovimientoCcDto) {
    const current = await this.findOne(id, tenantId);
    const cid = dto.clienteId ?? current.clienteId;
    await this.assertCliente(tenantId, cid);
    return this.prisma.movimientoCuentaCorriente.update({
      where: { id },
      data: {
        ...dto,
        fecha: dto.fecha === undefined ? undefined : new Date(dto.fecha),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.movimientoCuentaCorriente.delete({ where: { id } });
  }
}
