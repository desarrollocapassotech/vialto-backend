import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';

import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import { CreatePagoDto } from './dto/create-pago.dto';
import { FacturasPaginatedQueryDto } from './dto/facturas-paginated-query.dto';
import type { Prisma } from '@prisma/client';
import {
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from './factura-estado-lectura';

type ViajeSnap = { id: string; estado: string; monto: number | null; monedaMonto: string };

@Injectable()
export class FacturacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private computeImporte(viajes: { monto: number | null }[]): number {
    return viajes.reduce((sum, v) => sum + (v.monto ?? 0), 0);
  }

  private toShape(row: {
    id: string; tenantId: string; numero: string; tipo: string;
    clienteId: string | null; transportistaId: string | null; importe: number;
    moneda: string;
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

  private async assertTransportistaCtx(tenantId: string, transportistaId?: string | null) {
    if (transportistaId) {
      const t = await this.prisma.transportista.findFirst({ where: { id: transportistaId, tenantId } });
      if (!t) throw new BadRequestException('Transportista inválido');
    }
  }

  private async resolveViajes(tenantId: string, viajeIds: string[]): Promise<ViajeSnap[]> {
    if (viajeIds.length === 0) return [];
    const rows = await this.prisma.viaje.findMany({
      where: { id: { in: viajeIds }, tenantId },
      select: { id: true, estado: true, monto: true, monedaMonto: true },
    });
    if (rows.length !== viajeIds.length) {
      throw new BadRequestException('Uno o más viajes inválidos para este tenant');
    }
    return rows;
  }

  private assertMonedaUnica(viajes: { monedaMonto: string }[]): string {
    if (viajes.length === 0) return 'ARS';
    const monedas = new Set(viajes.map((v) => v.monedaMonto ?? 'ARS'));
    if (monedas.size > 1) {
      throw new BadRequestException(
        'Una factura no puede contener viajes en distintas monedas. Generá una factura por moneda.',
      );
    }
    return [...monedas][0];
  }

  private readonly VIAJE_SELECT = { id: true, estado: true, monto: true, monedaMonto: true } as const;
  private readonly PAGO_SELECT = { importe: true } as const;

  async uploadComprobante(tenantId: string, file: Express.Multer.File): Promise<{ url: string }> {
    const name = file.originalname.toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.mimetype.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
    if (!isPdf && !isImage) {
      throw new BadRequestException('El comprobante debe ser un PDF o una imagen.');
    }
    const url = await this.cloudinary.uploadComprobanteArchivo(
      tenantId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { url };
  }

  private buildFacturasWhere(
    tenantId: string,
    query: Pick<
      FacturasPaginatedQueryDto,
      | 'numero'
      | 'tipo'
      | 'clienteId'
      | 'emisionDesde'
      | 'emisionHasta'
      | 'vencimientoDesde'
      | 'vencimientoHasta'
    >,
  ): Prisma.FacturaWhereInput {
    const where: Prisma.FacturaWhereInput = { tenantId };

    if (query.numero?.trim()) {
      where.numero = { contains: query.numero.trim(), mode: 'insensitive' };
    }
    if (query.tipo) where.tipo = query.tipo;
    if (query.clienteId) where.clienteId = query.clienteId;

    if (query.emisionDesde || query.emisionHasta) {
      where.fechaEmision = {};
      if (query.emisionDesde) {
        where.fechaEmision.gte = new Date(`${query.emisionDesde}T00:00:00.000Z`);
      }
      if (query.emisionHasta) {
        where.fechaEmision.lte = new Date(`${query.emisionHasta}T23:59:59.999Z`);
      }
    }

    if (query.vencimientoDesde || query.vencimientoHasta) {
      where.fechaVencimiento = { not: null };
      if (query.vencimientoDesde) {
        where.fechaVencimiento.gte = new Date(`${query.vencimientoDesde}T00:00:00.000Z`);
      }
      if (query.vencimientoHasta) {
        where.fechaVencimiento.lte = new Date(`${query.vencimientoHasta}T23:59:59.999Z`);
      }
    }

    return where;
  }

  private paginatedMeta(page: number, pageSize: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    };
  }

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

  async findAllPaginated(tenantId: string, query: FacturasPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = this.buildFacturasWhere(tenantId, query);
    const include = {
      viajes: { select: this.VIAJE_SELECT },
      pagos: { select: this.PAGO_SELECT },
    } as const;

    if (query.estado) {
      const rows = await this.prisma.factura.findMany({
        where,
        orderBy: { fechaEmision: 'desc' },
        include,
      });
      const filtered = rows
        .map((r) => this.toShape(r))
        .filter((f) => f.estado === query.estado);
      const total = filtered.length;
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);
      return { items, meta: this.paginatedMeta(page, pageSize, total) };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.factura.count({ where }),
      this.prisma.factura.findMany({
        where,
        orderBy: { fechaEmision: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
      }),
    ]);

    return {
      items: rows.map((r) => this.toShape(r)),
      meta: this.paginatedMeta(page, pageSize, total),
    };
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
    await this.assertTransportistaCtx(tenantId, dto.transportistaId);
    const viajeIds = dto.viajeIds ?? [];
    const viajes = await this.resolveViajes(tenantId, viajeIds);
    const moneda = this.assertMonedaUnica(viajes);
    const importe = this.computeImporte(viajes);

    return this.prisma.$transaction(async (tx) => {
      const factura = await tx.factura.create({
        data: {
          tenantId,
          numero: dto.numero,
          tipo: dto.tipo,
          clienteId: dto.clienteId ?? null,
          transportistaId: dto.transportistaId ?? null,
          importe,
          moneda,
          fechaEmision: new Date(dto.fechaEmision),
          fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
          estado: 'pendiente',
          diferencia: dto.diferencia ?? null,
          ivaPct: dto.ivaPct ?? 21,
          comprobanteUrl: dto.comprobanteUrl ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });
      if (viajeIds.length > 0) {
        // Vincular viajes y guardar nro de factura
        await tx.viaje.updateMany({
          where: { id: { in: viajeIds }, tenantId },
          data: { facturaId: factura.id },
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
    await this.assertTransportistaCtx(tenantId, dto.transportistaId);

    let monedaNueva: string | undefined;
    if (dto.viajeIds !== undefined && dto.viajeIds.length > 0) {
      const viajesNuevos = await this.prisma.viaje.findMany({
        where: { id: { in: dto.viajeIds }, tenantId },
        select: { id: true, monedaMonto: true },
      });
      if (viajesNuevos.length !== dto.viajeIds.length) {
        throw new BadRequestException('Uno o más viajes inválidos');
      }
      monedaNueva = this.assertMonedaUnica(viajesNuevos);
    }

    return this.prisma.$transaction(async (tx) => {
      // Actualizar campos de la factura
      const facturaActualizada = await tx.factura.update({
        where: { id },
        data: {
          ...(dto.numero !== undefined ? { numero: dto.numero } : {}),
          ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
          ...(dto.clienteId !== undefined ? { clienteId: dto.clienteId || null } : {}),
          ...(dto.transportistaId !== undefined ? { transportistaId: dto.transportistaId || null } : {}),
          ...(dto.diferencia !== undefined ? { diferencia: dto.diferencia } : {}),
          ...(dto.fechaEmision !== undefined ? { fechaEmision: new Date(dto.fechaEmision) } : {}),
          ...(dto.fechaVencimiento !== undefined
            ? { fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null }
            : {}),
          ...(dto.ivaPct !== undefined ? { ivaPct: dto.ivaPct } : {}),
          ...(dto.comprobanteUrl !== undefined ? { comprobanteUrl: dto.comprobanteUrl || null } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });

      // Revinculación de viajes si se indica
      if (dto.viajeIds !== undefined) {
        const newIds = dto.viajeIds;

        // Obtener IDs de viajes que se van a desvincular
        const desvinculados = await tx.viaje.findMany({
          where: { facturaId: id, tenantId, id: { notIn: newIds } },
          select: { id: true },
        });
        const idsDesvinculados = desvinculados.map((v) => v.id);

        if (idsDesvinculados.length > 0) {
          // Revertir estado a 'finalizado' solo si estaban en 'facturado_sin_cobrar'
          await tx.viaje.updateMany({
            where: { id: { in: idsDesvinculados }, tenantId, estado: 'facturado_sin_cobrar' },
            data: { estado: 'finalizado_sin_facturar' },
          });
          // Desvincular todos
          await tx.viaje.updateMany({
            where: { id: { in: idsDesvinculados }, tenantId },
            data: { facturaId: null },
          });
        }

        // Vincular viajes nuevos y existentes
        if (newIds.length > 0) {
          await tx.viaje.updateMany({
            where: { id: { in: newIds }, tenantId },
            data: { facturaId: id },
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
      }

      // Recalcular importe y moneda desde los viajes vinculados
      const viajes = await tx.viaje.findMany({
        where: { facturaId: id, tenantId },
        select: this.VIAJE_SELECT,
      });
      const importe = this.computeImporte(viajes);
      const updated = await tx.factura.update({
        where: { id },
        data: { importe, ...(monedaNueva !== undefined ? { moneda: monedaNueva } : {}) },
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
    // Revertir estado de viajes facturados_sin_cobrar a finalizado
    await this.prisma.viaje.updateMany({
      where: { facturaId: id, tenantId, estado: 'facturado_sin_cobrar' },
      data: { estado: 'finalizado_sin_facturar' },
    });
    // Desvincular todos los viajes
    await this.prisma.viaje.updateMany({
      where: { facturaId: id, tenantId },
      data: { facturaId: null },
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
    const pago = await this.prisma.pago.create({
      data: {
        tenantId,
        facturaId: dto.facturaId,
        importe: dto.importe,
        fecha: new Date(dto.fecha),
        formaPago: dto.formaPago ?? null,
      },
    });
    await this.syncViajesEstadoTrasPago(dto.facturaId, tenantId);
    return pago;
  }

  async removePago(id: string, tenantId: string) {
    const row = await this.prisma.pago.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Pago no encontrado');
    await this.prisma.pago.delete({ where: { id } });
    await this.syncViajesEstadoTrasPago(row.facturaId, tenantId);
    return row;
  }

  /** Alinea estado de viajes vinculados con cobro total o parcial de la factura. */
  private async syncViajesEstadoTrasPago(facturaId: string, tenantId: string): Promise<void> {
    const factura = await this.prisma.factura.findFirst({
      where: { id: facturaId, tenantId },
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
    });
    if (!factura) return;

    const estadoLectura = computeEstadoFacturaLectura({
      viajes: factura.viajes,
      fechaVencimiento: factura.fechaVencimiento,
      importeGuardado: factura.importe,
      pagos: factura.pagos,
    });

    if (estadoLectura === 'cobrada') {
      await this.prisma.viaje.updateMany({
        where: {
          facturaId,
          tenantId,
          estado: { in: ['facturado_sin_cobrar', 'finalizado_facturado'] },
        },
        data: { estado: 'cobrado' },
      });
      return;
    }

    await this.prisma.viaje.updateMany({
      where: { facturaId, tenantId, estado: 'cobrado' },
      data: { estado: 'facturado_sin_cobrar' },
    });
  }
}
