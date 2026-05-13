import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductosPaginatedQueryDto } from './dto/productos-paginated-query.dto';
import { CreatePresentacionDto } from './dto/create-presentacion.dto';
import { UpdatePresentacionDto } from './dto/update-presentacion.dto';
import { CreateMovimientoStockDto } from './dto/create-movimiento-stock.dto';
import { UpdateMovimientoStockDto } from './dto/update-movimiento-stock.dto';
import { CreateIngresoDto } from './dto/create-ingreso.dto';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de normalización (mismo patrón que Carga)
// ─────────────────────────────────────────────────────────────────────────────

function normalizarNombre(nombre: string): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function displayNombre(nombre: string): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shapes públicas
// ─────────────────────────────────────────────────────────────────────────────

const productoSelect = {
  id: true,
  tenantId: true,
  nombre: true,
  descripcion: true,
  unidadMedida: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
} as const;

const productoWithPresentacionesSelect = {
  ...productoSelect,
  presentaciones: {
    select: {
      id: true,
      productoId: true,
      nombre: true,
      cantidadEquivalente: true,
      unidadEquivalente: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { nombre: 'asc' as const },
  },
} as const;

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────── PRODUCTOS ──────────────────────────────────────────────

  async findAllProductosPaginated(tenantId: string, query: ProductosPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.ProductoWhereInput = { tenantId };

    const q = query.q?.trim();
    if (q) {
      where.nombre = { contains: q, mode: 'insensitive' };
    }

    const fa = query.filtroActivo ?? 'todos';
    if (fa === 'activos') where.activo = true;
    else if (fa === 'inactivos') where.activo = false;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.producto.count({ where }),
      this.prisma.producto.findMany({
        where,
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: productoSelect,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: rows,
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

  async findProducto(id: string, tenantId: string) {
    const row = await this.prisma.producto.findFirst({
      where: { id, tenantId },
      select: productoWithPresentacionesSelect,
    });
    if (!row) throw new NotFoundException('Producto no encontrado');
    return row;
  }

  async createProducto(tenantId: string, dto: CreateProductoDto) {
    const nombre = displayNombre(dto.nombre);
    if (!nombre) throw new ConflictException('El nombre no puede quedar vacío.');
    const nombreNormalizado = normalizarNombre(nombre);

    try {
      return await this.prisma.producto.create({
        data: {
          tenantId,
          nombre,
          nombreNormalizado,
          descripcion: dto.descripcion?.trim() || null,
          unidadMedida: dto.unidadMedida?.trim() || '',
          activo: dto.activo ?? true,
        },
        select: productoSelect,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un producto con ese nombre (sin distinguir mayúsculas).');
      }
      throw e;
    }
  }

  async updateProducto(id: string, tenantId: string, dto: UpdateProductoDto) {
    const current = await this.prisma.producto.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException('Producto no encontrado');

    const nombre =
      dto.nombre !== undefined ? displayNombre(dto.nombre) : current.nombre;
    if (dto.nombre !== undefined && !nombre) {
      throw new ConflictException('El nombre no puede quedar vacío.');
    }
    const nombreNormalizado =
      dto.nombre !== undefined ? normalizarNombre(nombre) : current.nombreNormalizado;

    try {
      return await this.prisma.producto.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre, nombreNormalizado } : {}),
          ...(dto.descripcion !== undefined
            ? { descripcion: dto.descripcion?.trim() || null }
            : {}),
          ...(dto.unidadMedida !== undefined
            ? { unidadMedida: dto.unidadMedida?.trim() || '' }
            : {}),
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        },
        select: productoSelect,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un producto con ese nombre (sin distinguir mayúsculas).');
      }
      throw e;
    }
  }

  // ───────────────── PRESENTACIONES ─────────────────────────────────────────

  async listPresentaciones(productoId: string, tenantId: string) {
    await this.findProducto(productoId, tenantId);
    return this.prisma.presentacion.findMany({
      where: { productoId },
      orderBy: { nombre: 'asc' },
    });
  }

  async createPresentacion(productoId: string, tenantId: string, dto: CreatePresentacionDto) {
    await this.findProducto(productoId, tenantId);
    return this.prisma.presentacion.create({
      data: {
        tenantId,
        productoId,
        nombre: dto.nombre.trim(),
        cantidadEquivalente: dto.cantidadEquivalente,
        unidadEquivalente: dto.unidadEquivalente.trim(),
      },
    });
  }

  async updatePresentacion(
    productoId: string,
    presentacionId: string,
    tenantId: string,
    dto: UpdatePresentacionDto,
  ) {
    await this.findProducto(productoId, tenantId);
    const p = await this.prisma.presentacion.findFirst({
      where: { id: presentacionId, productoId },
    });
    if (!p) throw new NotFoundException('Presentación no encontrada');

    return this.prisma.presentacion.update({
      where: { id: presentacionId },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.cantidadEquivalente !== undefined
          ? { cantidadEquivalente: dto.cantidadEquivalente }
          : {}),
        ...(dto.unidadEquivalente !== undefined
          ? { unidadEquivalente: dto.unidadEquivalente.trim() }
          : {}),
      },
    });
  }

  async removePresentacion(productoId: string, presentacionId: string, tenantId: string) {
    await this.findProducto(productoId, tenantId);
    const p = await this.prisma.presentacion.findFirst({
      where: { id: presentacionId, productoId },
    });
    if (!p) throw new NotFoundException('Presentación no encontrada');
    return this.prisma.presentacion.delete({ where: { id: presentacionId } });
  }

  // ───────────────── MOVIMIENTOS DE STOCK ───────────────────────────────────

  private async assertProductoCliente(tenantId: string, productoId: string, clienteId: string) {
    const [p, c] = await Promise.all([
      this.prisma.producto.findFirst({ where: { id: productoId, tenantId } }),
      this.prisma.cliente.findFirst({ where: { id: clienteId, tenantId } }),
    ]);
    if (!p) throw new BadRequestException('Producto inválido');
    if (!c) throw new BadRequestException('Cliente inválido');
  }

  private async assertRemito(tenantId: string, remitoId?: string | null) {
    if (!remitoId) return;
    const r = await this.prisma.remito.findFirst({ where: { id: remitoId, tenantId } });
    if (!r) throw new BadRequestException('Remito inválido');
  }

  listMovimientos(tenantId: string, productoId?: string, clienteId?: string) {
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        ...(productoId ? { productoId } : {}),
        ...(clienteId ? { clienteId } : {}),
      },
      orderBy: { fecha: 'desc' },
      take: 500,
    });
  }

  async findMovimiento(id: string, tenantId: string) {
    const row = await this.prisma.movimientoStock.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Movimiento de stock no encontrado');
    return row;
  }

  async createMovimiento(tenantId: string, dto: CreateMovimientoStockDto) {
    await this.assertProductoCliente(tenantId, dto.productoId, dto.clienteId);
    await this.assertRemito(tenantId, dto.remitoId);
    return this.prisma.movimientoStock.create({
      data: {
        tenantId,
        productoId: dto.productoId,
        clienteId: dto.clienteId,
        tipo: dto.tipo,
        cantidad: dto.cantidad,
        remitoId: dto.remitoId ?? null,
        fecha: new Date(dto.fecha),
      },
    });
  }

  async updateMovimiento(id: string, tenantId: string, dto: UpdateMovimientoStockDto) {
    const cur = await this.findMovimiento(id, tenantId);
    const pid = dto.productoId ?? cur.productoId;
    const cid = dto.clienteId ?? cur.clienteId;
    await this.assertProductoCliente(tenantId, pid, cid);
    await this.assertRemito(tenantId, dto.remitoId);
    return this.prisma.movimientoStock.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...dto,
        fecha: dto.fecha === undefined ? undefined : new Date(dto.fecha),
      } as any,
    });
  }

  async removeMovimiento(id: string, tenantId: string) {
    await this.findMovimiento(id, tenantId);
    return this.prisma.movimientoStock.delete({ where: { id } });
  }

  // ───────────────── INGRESOS AL DEPÓSITO ───────────────────────────────────

  async createIngreso(tenantId: string, dto: CreateIngresoDto, createdBy: string) {
    const [producto, presentacion, cliente] = await Promise.all([
      this.prisma.producto.findFirst({ where: { id: dto.productoId, tenantId } }),
      this.prisma.presentacion.findFirst({ where: { id: dto.presentacionId, productoId: dto.productoId } }),
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
    ]);
    if (!producto) throw new BadRequestException('Producto inválido');
    if (!presentacion) throw new BadRequestException('Presentación inválida');
    if (!cliente) throw new BadRequestException('Cliente inválido');

    return this.prisma.$transaction(async (tx) => {
      const movimiento = await tx.movimientoStock.create({
        data: {
          tenantId,
          productoId: dto.productoId,
          presentacionId: dto.presentacionId,
          clienteId: dto.clienteId,
          tipo: 'ingreso',
          cantidad: dto.cantidad,

          observaciones: dto.observaciones?.trim() || null,
          createdBy,
          fecha: new Date(dto.fecha),
        },
        include: {
          producto: { select: { id: true, nombre: true, unidadMedida: true } },
          presentacion: { select: { id: true, nombre: true } },
          cliente: { select: { id: true, nombre: true } },
        },
      });

      await tx.stockItem.upsert({
        where: {
          productoId_presentacionId_clienteId: {
            productoId: dto.productoId,
            presentacionId: dto.presentacionId,
            clienteId: dto.clienteId,
          },
        },
        update: { cantidad: { increment: dto.cantidad }, tenantId },
        create: {
          tenantId,
          productoId: dto.productoId,
          presentacionId: dto.presentacionId,
          clienteId: dto.clienteId,
          cantidad: dto.cantidad,
        },
      });

      return movimiento;
    });
  }

  listIngresos(tenantId: string, clienteId?: string, productoId?: string) {
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        tipo: 'ingreso',
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        producto: { select: { id: true, nombre: true, unidadMedida: true } },
        presentacion: { select: { id: true, nombre: true } },
        cliente: { select: { id: true, nombre: true } },
      },
    });
  }

  listStockDisponible(tenantId: string, clienteId?: string, productoId?: string) {
    return this.prisma.stockItem.findMany({
      where: {
        tenantId,
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
      },
      orderBy: [{ clienteId: 'asc' }, { productoId: 'asc' }],
      include: {
        producto: { select: { id: true, nombre: true, unidadMedida: true } },
        presentacion: { select: { id: true, nombre: true } },
        cliente: { select: { id: true, nombre: true } },
      },
    });
  }
}
