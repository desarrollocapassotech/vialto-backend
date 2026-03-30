import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import { CreatePagoDto } from './dto/create-pago.dto';

@Injectable()
export class FacturacionService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertFacturaCtx(tenantId: string, dto: {
    clienteId?: string | null;
    viajeId?: string | null;
  }) {
    if (dto.clienteId) {
      const c = await this.prisma.cliente.findFirst({
        where: { id: dto.clienteId, tenantId },
      });
      if (!c) throw new BadRequestException('Cliente inválido');
    }
    if (dto.viajeId) {
      const v = await this.prisma.viaje.findFirst({
        where: { id: dto.viajeId, tenantId },
      });
      if (!v) throw new BadRequestException('Viaje inválido');
    }
  }

  listFacturas(tenantId: string) {
    return this.prisma.factura.findMany({
      where: { tenantId },
      orderBy: { fechaEmision: 'desc' },
      include: { pagos: true },
      take: 200,
    });
  }

  async findFactura(id: string, tenantId: string) {
    const row = await this.prisma.factura.findFirst({
      where: { id, tenantId },
      include: { pagos: true },
    });
    if (!row) throw new NotFoundException('Factura no encontrada');
    return row;
  }

  async createFactura(tenantId: string, dto: CreateFacturaDto) {
    await this.assertFacturaCtx(tenantId, {
      clienteId: dto.clienteId,
      viajeId: dto.viajeId,
    });
    return this.prisma.factura.create({
      data: {
        tenantId,
        numero: dto.numero,
        tipo: dto.tipo,
        clienteId: dto.clienteId ?? null,
        viajeId: dto.viajeId ?? null,
        importe: dto.importe,
        fechaEmision: new Date(dto.fechaEmision),
        fechaVencimiento: dto.fechaVencimiento
          ? new Date(dto.fechaVencimiento)
          : null,
        estado: dto.estado ?? 'pendiente',
        diferencia: dto.diferencia ?? null,
      },
    });
  }

  async updateFactura(id: string, tenantId: string, dto: UpdateFacturaDto) {
    await this.findFactura(id, tenantId);
    await this.assertFacturaCtx(tenantId, {
      clienteId: dto.clienteId,
      viajeId: dto.viajeId,
    });
    return this.prisma.factura.update({
      where: { id },
      data: {
        ...dto,
        fechaEmision:
          dto.fechaEmision === undefined
            ? undefined
            : new Date(dto.fechaEmision),
        fechaVencimiento:
          dto.fechaVencimiento === undefined
            ? undefined
            : dto.fechaVencimiento
              ? new Date(dto.fechaVencimiento)
              : null,
      },
    });
  }

  async removeFactura(id: string, tenantId: string) {
    await this.findFactura(id, tenantId);
    return this.prisma.factura.delete({ where: { id } });
  }

  listPagos(tenantId: string, facturaId?: string) {
    return this.prisma.pago.findMany({
      where: { tenantId, ...(facturaId ? { facturaId } : {}) },
      orderBy: { fecha: 'desc' },
      take: 200,
    });
  }

  async createPago(tenantId: string, dto: CreatePagoDto) {
    await this.findFactura(dto.facturaId, tenantId);
    return this.prisma.pago.create({
      data: {
        tenantId,
        facturaId: dto.facturaId,
        importe: dto.importe,
        fecha: new Date(dto.fecha),
        formaPago: dto.formaPago ?? null,
      },
    });
  }

  async removePago(id: string, tenantId: string) {
    const row = await this.prisma.pago.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Pago no encontrado');
    return this.prisma.pago.delete({ where: { id } });
  }
}
