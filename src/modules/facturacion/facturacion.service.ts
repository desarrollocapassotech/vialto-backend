import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import { CreatePagoDto } from './dto/create-pago.dto';
import {
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from './factura-estado-lectura';

type ViajeSnap = { id: string; estado: string; monto: number | null };

@Injectable()
export class FacturacionService {
  constructor(private readonly prisma: PrismaService) {}

  private computeImporte(viajes: { monto: number | null }[]): number {
    return viajes.reduce((sum, v) => sum + (v.monto ?? 0), 0);
  }

  private toShape(row: {
    id: string; tenantId: string; numero: string; tipo: string;
    clienteId: string | null; importe: number;
    fechaEmision: Date; fechaVencimiento: Date | null;
    estado: string; diferencia: number | null; createdAt: Date;
    viajes: ViajeSnap[];
    pagos?: { importe: number }[];
  }) {
    const { viajes, pagos = [], ...f } = row;
    const importe = importeOperativoFactura(f.importe, viajes);
    return {
      ...f,
      viajeIds: viajes.map((v) => v.id),
      importe,
      estado: computeEstadoFacturaLectura({
        viajes,
        fechaVencimiento: f.fechaVencimiento,
        importeGuardado: f.importe,
        pagos,
      }),
    };
  }

  private async assertClienteCtx(tenantId: string, clienteId?: string | null) {
    if (clienteId) {
      const c = await this.prisma.cliente.findFirst({ where: { id: clienteId, tenantId } });
      if (!c) throw new BadRequestException('Cliente inválido');
    }
  }

  private async resolveViajes(tenantId: string, viajeIds: string[]): Promise<ViajeSnap[]> {
    if (viajeIds.length === 0) return [];
    const rows = await this.prisma.viaje.findMany({
      where: { id: { in: viajeIds }, tenantId },
      select: { id: true, estado: true, monto: true },
    });
    if (rows.length !== viajeIds.length) {
      throw new BadRequestException('Uno o más viajes inválidos para este tenant');
    }
    return rows;
  }

  private readonly VIAJE_SELECT = { id: true, estado: true, monto: true } as const;
  private readonly PAGO_SELECT = { importe: true } as const;

  async listFacturas(tenantId: string, clienteId?: string) {
    const rows = await this.prisma.factura.findMany({
      where: { tenantId, ...(clienteId ? { clienteId } : {}) },
      orderBy: { fechaEmision: 'desc' },
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
      take: 200,
    });
    return rows.map((r) => this.toShape(r));
  }

  async findFactura(id: string, tenantId: string) {
    const row = await this.prisma.factura.findFirst({
      where: { id, tenantId },
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
    });
    if (!row) throw new NotFoundException('Factura no encontrada');
    return this.toShape(row);
  }

  async createFactura(tenantId: string, dto: CreateFacturaDto) {
    await this.assertClienteCtx(tenantId, dto.clienteId);
    const viajeIds = dto.viajeIds ?? [];
    const viajes = await this.resolveViajes(tenantId, viajeIds);
    const importe = this.computeImporte(viajes);

    return this.prisma.$transaction(async (tx) => {
      const factura = await tx.factura.create({
        data: {
          tenantId,
          numero: dto.numero,
          tipo: dto.tipo,
          clienteId: dto.clienteId ?? null,
          importe,
          fechaEmision: new Date(dto.fechaEmision),
          fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
          estado: 'pendiente',
          diferencia: dto.diferencia ?? null,
        },
      });
      if (viajeIds.length > 0) {
        // Vincular viajes y guardar nro de factura
        await tx.viaje.updateMany({
          where: { id: { in: viajeIds }, tenantId },
          data: { facturaId: factura.id, nroFactura: dto.numero },
        });
        // Corregir estado: solo los que aún no están en estado de facturación/cobro
        await tx.viaje.updateMany({
          where: {
            id: { in: viajeIds },
            tenantId,
            estado: { notIn: ['facturado_sin_cobrar', 'cobrado'] },
          },
          data: { estado: 'facturado_sin_cobrar' },
        });
      }
      const updated = await tx.factura.findFirst({
        where: { id: factura.id },
        include: {
          viajes: { select: this.VIAJE_SELECT },
          pagos: { select: this.PAGO_SELECT },
        },
      });
      return this.toShape(updated!);
    });
  }

  async updateFactura(id: string, tenantId: string, dto: UpdateFacturaDto) {
    await this.findFactura(id, tenantId);
    await this.assertClienteCtx(tenantId, dto.clienteId);

    return this.prisma.$transaction(async (tx) => {
      // Actualizar campos de la factura
      const facturaActualizada = await tx.factura.update({
        where: { id },
        data: {
          ...(dto.numero !== undefined ? { numero: dto.numero } : {}),
          ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
          ...(dto.clienteId !== undefined ? { clienteId: dto.clienteId || null } : {}),
          ...(dto.diferencia !== undefined ? { diferencia: dto.diferencia } : {}),
          ...(dto.fechaEmision !== undefined ? { fechaEmision: new Date(dto.fechaEmision) } : {}),
          ...(dto.fechaVencimiento !== undefined
            ? { fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null }
            : {}),
        },
      });

      const nroFacturaVigente = facturaActualizada.numero;

      // Revinculación de viajes si se indica
      if (dto.viajeIds !== undefined) {
        const newIds = dto.viajeIds;
        if (newIds.length > 0) {
          const found = await tx.viaje.findMany({
            where: { id: { in: newIds }, tenantId },
            select: { id: true },
          });
          if (found.length !== newIds.length) {
            throw new BadRequestException('Uno o más viajes inválidos');
          }
        }
        // Desvincular viajes que ya no pertenecen a esta factura
        await tx.viaje.updateMany({
          where: { facturaId: id, tenantId, id: { notIn: newIds } },
          data: { facturaId: null, nroFactura: null },
        });
        // Vincular y actualizar nroFactura en viajes nuevos y existentes
        if (newIds.length > 0) {
          await tx.viaje.updateMany({
            where: { id: { in: newIds }, tenantId },
            data: { facturaId: id, nroFactura: nroFacturaVigente },
          });
          // Corregir estado de los viajes recién vinculados que no están en estado correcto
          await tx.viaje.updateMany({
            where: {
              id: { in: newIds },
              tenantId,
              estado: { notIn: ['facturado_sin_cobrar', 'cobrado'] },
            },
            data: { estado: 'facturado_sin_cobrar' },
          });
        }
      } else if (dto.numero !== undefined) {
        // Si solo cambió el número de factura, actualizar nroFactura en todos los viajes vinculados
        await tx.viaje.updateMany({
          where: { facturaId: id, tenantId },
          data: { nroFactura: nroFacturaVigente },
        });
      }

      // Recalcular importe desde los viajes vinculados
      const viajes = await tx.viaje.findMany({
        where: { facturaId: id },
        select: this.VIAJE_SELECT,
      });
      const importe = this.computeImporte(viajes);
      const updated = await tx.factura.update({
        where: { id },
        data: { importe },
        include: {
          viajes: { select: this.VIAJE_SELECT },
          pagos: { select: this.PAGO_SELECT },
        },
      });
      return this.toShape(updated);
    });
  }

  async removeFactura(id: string, tenantId: string) {
    await this.findFactura(id, tenantId);
    // Desvincular viajes y limpiar nroFactura antes de eliminar
    await this.prisma.viaje.updateMany({
      where: { facturaId: id, tenantId },
      data: { facturaId: null, nroFactura: null },
    });
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
