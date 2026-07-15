import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductosPaginatedQueryDto } from './dto/productos-paginated-query.dto';
import { CreateMovimientoStockDto } from './dto/create-movimiento-stock.dto';
import { UpdateMovimientoStockDto } from './dto/update-movimiento-stock.dto';
import { CreateIngresoDto } from './dto/create-ingreso.dto';
import { CreateEgresoDto } from './dto/create-egreso.dto';
import { UpdateStockEgresoRemitoConfigDto } from './dto/update-stock-egreso-remito-config.dto';
import { CreatePresentacionDto } from './dto/create-presentacion.dto';
import { UpdatePresentacionDto } from './dto/update-presentacion.dto';
import { CreateDivisionDto } from './dto/create-division.dto';
import { CreateDepositoDto } from './dto/create-deposito.dto';
import { UpdateDepositoDto } from './dto/update-deposito.dto';
import { ClerkVialtoRoleService } from '../../core/auth/clerk-vialto-role.service';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';
import { parseFechaMovimientoStock, yearInBuenosAires, parseYyyyMmDdInicioAr, parseYyyyMmDdFinAr } from './stock-fecha.util';
import { resolverLoteIngreso } from './stock-lote.util';
import { paginate, buildPaginatedResult } from '../../shared/util/pagination.util';
import { RemitoInternoPdfService } from './remito-interno-pdf.service';
import { PaginationQueryDto } from 'shared/dto/pagination-query.dto';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers de normalización
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalizarNombre(nombre: string): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function displayNombre(nombre: string): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ');
}

const STUB_MSG = 'Operación pendiente de rediseño para el nuevo modelo de operaciones de stock.';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Shapes públicas
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const productoSelect = {
  id: true,
  tenantId: true,
  nombre: true,
  codigo: true,
  descripcion: true,
  pesoUnitarioKg: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
  productoPresentaciones: {
    where: { activo: true },
    select: {
      id: true,
      presentacionId: true,
      presentacion: { select: { id: true, nombre: true } },
      unidadesPorBulto: true,
      activo: true,
    },
  },
} as const;

const presentacionSelect = {
  id: true,
  tenantId: true,
  nombre: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
} as const;

const productoMiniSelect = {
  id: true,
  nombre: true,
} as const;

const stockItemRelations = {
  producto: { select: productoMiniSelect },
  cliente: { select: { id: true, nombre: true } },
  deposito: { select: { id: true, nombre: true } },
} as const;

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerkUsers: ClerkVialtoRoleService,
    private readonly cloudinary: CloudinaryService,
    private readonly remitoInternoPdf: RemitoInternoPdfService,
  ) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PRODUCTOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async findAllProductosPaginated(tenantId: string, query: ProductosPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.ProductoWhereInput = { tenantId };

    const q = query.q?.trim();
    if (q) where.nombre = { contains: q, mode: 'insensitive' };

    const codigoQ = query.codigo?.trim();
    if (codigoQ) where.codigo = { contains: codigoQ, mode: 'insensitive' };

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
      select: productoSelect,
    });
    if (!row) throw new NotFoundException('Producto no encontrado');
    return row;
  }

  private async nextProductoCodigoTx(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const id = randomUUID().replace(/-/g, '').slice(0, 25);
    const rows = await tx.$queryRaw<{ lastValue: number }[]>(
      Prisma.sql`
        INSERT INTO "producto_secuencias" ("id", "tenantId", "lastValue")
        VALUES (${id}, ${tenantId}, 1)
        ON CONFLICT ("tenantId")
        DO UPDATE SET "lastValue" = "producto_secuencias"."lastValue" + 1
        RETURNING "lastValue"
      `,
    );
    const n = rows[0]?.lastValue;
    if (n === undefined || n === null) throw new BadRequestException('No se pudo generar el código de producto.');
    return `P-${String(n).padStart(3, '0')}`;
  }

  async createProducto(tenantId: string, dto: CreateProductoDto) {
    const nombre = displayNombre(dto.nombre);
    if (!nombre) throw new ConflictException('El nombre no puede quedar vacío.');
    const nombreNormalizado = normalizarNombre(nombre);

    // Validar presentaciones: sin duplicados y todas activas
    const presIds = dto.presentaciones.map((p) => p.presentacionId);
    if (new Set(presIds).size !== presIds.length) {
      throw new BadRequestException('No se pueden repetir presentaciones en el mismo producto.');
    }
    for (const pp of dto.presentaciones) {
      const p = await this.prisma.presentacion.findFirst({
        where: { id: pp.presentacionId, tenantId, activo: true },
      });
      if (!p) throw new BadRequestException(`Presentación inválida o inactiva: ${pp.presentacionId}`);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const codigo = await this.nextProductoCodigoTx(tx, tenantId);
        const { id } = await tx.producto.create({
          data: {
            tenantId,
            nombre,
            nombreNormalizado,
            codigo,
            descripcion: dto.descripcion?.trim() || null,
            pesoUnitarioKg: dto.pesoUnitarioKg,
            activo: dto.activo ?? true,
          },
          select: { id: true },
        });

        await tx.productoPresentacion.createMany({
          data: dto.presentaciones.map((pp) => ({
            tenantId,
            productoId: id,
            presentacionId: pp.presentacionId,
            unidadesPorBulto: pp.unidadesPorBulto,
          })),
        });

        return tx.producto.findFirstOrThrow({ where: { id }, select: productoSelect });
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

    const nombre = dto.nombre !== undefined ? displayNombre(dto.nombre) : current.nombre;
    if (dto.nombre !== undefined && !nombre) throw new ConflictException('El nombre no puede quedar vacío.');
    const nombreNormalizado = dto.nombre !== undefined ? normalizarNombre(nombre) : current.nombreNormalizado;

    if (dto.presentaciones !== undefined) {
      const presIds = dto.presentaciones.map((p) => p.presentacionId);
      if (new Set(presIds).size !== presIds.length) {
        throw new BadRequestException('No se pueden repetir presentaciones en el mismo producto.');
      }
      for (const pp of dto.presentaciones) {
        const p = await this.prisma.presentacion.findFirst({
          where: { id: pp.presentacionId, tenantId, activo: true },
        });
        if (!p) throw new BadRequestException(`Presentación inválida o inactiva: ${pp.presentacionId}`);
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.producto.update({
          where: { id },
          data: {
            ...(dto.nombre !== undefined ? { nombre, nombreNormalizado } : {}),
            ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion?.trim() || null } : {}),
            ...(dto.pesoUnitarioKg !== undefined ? { pesoUnitarioKg: dto.pesoUnitarioKg } : {}),
            ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
          },
        });

        if (dto.presentaciones !== undefined) {
          const existing = await tx.productoPresentacion.findMany({
            where: { productoId: id, tenantId },
            select: { id: true },
          });

          const incomingIds = new Set(
            dto.presentaciones.filter((p) => p.id).map((p) => p.id as string),
          );
          const toDelete = existing.filter((e) => !incomingIds.has(e.id));

          for (const del of toDelete) {
            const movCount = await tx.movimientoStock.count({ where: { presentacionId: del.id } });
            if (movCount > 0) {
              throw new ConflictException(
                'No se puede eliminar una presentación que tiene movimientos de stock asociados.',
              );
            }
            await tx.productoPresentacion.delete({ where: { id: del.id } });
          }

          for (const pp of dto.presentaciones) {
            if (pp.id) {
              await tx.productoPresentacion.update({
                where: { id: pp.id },
                data: { unidadesPorBulto: pp.unidadesPorBulto },
              });
            } else {
              await tx.productoPresentacion.create({
                data: {
                  tenantId,
                  productoId: id,
                  presentacionId: pp.presentacionId,
                  unidadesPorBulto: pp.unidadesPorBulto,
                },
              });
            }
          }
        }

        return tx.producto.findFirstOrThrow({ where: { id }, select: productoSelect });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un producto con ese nombre (sin distinguir mayúsculas).');
      }
      throw e;
    }
  }

  async removeProductoPresentacion(productoId: string, ppId: string, tenantId: string) {
    const pp = await this.prisma.productoPresentacion.findFirst({
      where: { id: ppId, productoId, tenantId },
    });
    if (!pp) throw new NotFoundException('Presentación de producto no encontrada.');

    const count = await this.prisma.productoPresentacion.count({ where: { productoId, tenantId } });
    if (count <= 1) {
      throw new ConflictException('El producto debe tener al menos una presentación.');
    }

    const movCount = await this.prisma.movimientoStock.count({ where: { presentacionId: ppId } });
    if (movCount > 0) {
      throw new ConflictException(
        'No se puede eliminar una presentación que tiene movimientos de stock asociados.',
      );
    }

    return this.prisma.productoPresentacion.delete({ where: { id: ppId } });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DEPÓSITOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listDepositos(tenantId: string, query: PaginationQueryDto, activo?: boolean) {
    const { page, pageSize, skip, take } = paginate(query.page, query.pageSize);

    const where = {
      tenantId,
      ...(activo !== undefined ? { activo } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.deposito.count({ where }),
      this.prisma.deposito.findMany({
        where,
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        skip,
        take,
      }),
    ]);

    return buildPaginatedResult(rows, total, page, pageSize);
  }

  async createDeposito(tenantId: string, dto: CreateDepositoDto) {
    return this.prisma.deposito.create({
      data: {
        tenantId,
        nombre: dto.nombre.trim(),
        descripcion: dto.direccion?.trim() || null,
        activo: dto.activo ?? true,
      },
    });
  }

  async updateDeposito(id: string, tenantId: string, dto: UpdateDepositoDto) {
    const current = await this.prisma.deposito.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException('Depósito no encontrado');

    return this.prisma.deposito.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.direccion !== undefined ? { descripcion: dto.direccion?.trim() || null } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PRESENTACIONES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listPresentaciones(tenantId: string, activo?: boolean) {
    return this.prisma.presentacion.findMany({
      where: { tenantId, ...(activo !== undefined ? { activo } : {}) },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      select: presentacionSelect,
    });
  }

  async findPresentacion(id: string, tenantId: string) {
    const row = await this.prisma.presentacion.findFirst({
      where: { id, tenantId },
      select: presentacionSelect,
    });
    if (!row) throw new NotFoundException('Presentación no encontrada');
    return row;
  }

  async createPresentacion(tenantId: string, dto: CreatePresentacionDto) {
    const nombre = displayNombre(dto.nombre);
    if (!nombre) throw new ConflictException('El nombre no puede quedar vacío.');
    const nombreNormalizado = normalizarNombre(nombre);
    try {
      return await this.prisma.presentacion.create({
        data: { tenantId, nombre, nombreNormalizado, activo: dto.activo ?? true },
        select: presentacionSelect,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una presentación con ese nombre (sin distinguir mayúsculas).');
      }
      throw e;
    }
  }

  async updatePresentacion(id: string, tenantId: string, dto: UpdatePresentacionDto) {
    const current = await this.prisma.presentacion.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException('Presentación no encontrada');

    const nombre = dto.nombre !== undefined ? displayNombre(dto.nombre) : current.nombre;
    if (dto.nombre !== undefined && !nombre) throw new ConflictException('El nombre no puede quedar vacío.');
    const nombreNormalizado = dto.nombre !== undefined ? normalizarNombre(nombre) : current.nombreNormalizado;

    try {
      return await this.prisma.presentacion.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre, nombreNormalizado } : {}),
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        },
        select: presentacionSelect,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una presentación con ese nombre (sin distinguir mayúsculas).');
      }
      throw e;
    }
  }

  async removePresentacion(id: string, tenantId: string) {
    const row = await this.prisma.presentacion.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Presentación no encontrada');

    const count = await this.prisma.productoPresentacion.count({ where: { presentacionId: id } });
    if (count > 0) {
      throw new ConflictException('No se puede eliminar: hay productos que usan esta presentación.');
    }

    return this.prisma.presentacion.delete({ where: { id } });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ MOVIMIENTOS / OPERACIONES (pendientes de rediseño) â”€â”€â”€â”€â”€

  async listMovimientos(tenantId: string, query: PaginationQueryDto, productoId?: string, clienteId?: string, options?: {
    depositoId?: string;
    tipo?: 'ingreso' | 'egreso' | 'division';
    fechaDesde?: string;
    fechaHasta?: string;
    createdBy?: string;
  }) {
    const { depositoId, tipo, fechaDesde, fechaHasta, createdBy } = options ?? {};
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const where = {
      tenantId,
      ...(productoId ? { productoId } : {}),
      ...(fechaDesde || fechaHasta ? {
        fecha: {
          ...(fechaDesde ? { gte: new Date(fechaDesde) } : {}),
          ...(fechaHasta ? { lte: new Date(fechaHasta) } : {}),
        },
      } : {}),
      operacion: {
        ...(clienteId ? { clienteId } : {}),
        ...(depositoId ? { depositoId } : {}),
        ...(tipo ? { tipo } : {}),
        ...(createdBy ? { createdBy } : {}),
      },
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.movimientoStock.count({ where }),
      this.prisma.movimientoStock.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
            },
          },
          presentacion: {
            select: {
              id: true,
              unidadesPorBulto: true,
              presentacion: { select: { id: true, nombre: true } },
            },
          },
          operacion: {
            select: {
              id: true,
              clienteId: true,
              cliente: { select: { id: true, nombre: true } },
              depositoId: true,
              deposito: { select: { id: true, nombre: true } },
              tipo: true,
              observaciones: true,
              numeroRemito: true,
              remitoUrl: true,
              fotosUrls: true,
              entregadoPor: true,
              destinatario: true,
              destinoFinal: true,
              numeroDocumentoExterno: true,
              createdBy: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const items = rows.map((mov) => ({
      id: mov.id,
      tenantId: mov.tenantId,
      operacionId: mov.operacionId,
      productoId: mov.productoId,
      producto: mov.producto,
      presentacionId: mov.presentacionId,
      presentacion: mov.presentacion,
      bultos: mov.bultos,
      unidades: mov.unidades,
      fechaVencimiento: mov.fechaVencimiento?.toISOString() ?? null,
      lote: mov.lote,
      observaciones: mov.observaciones ?? mov.operacion.observaciones ?? null,
      movimientoVinculadoId: mov.movimientoVinculadoId,
      createdBy: mov.operacion.createdBy,
      fecha: mov.fecha.toISOString(),
      createdAt: mov.operacion.createdAt.toISOString(),
      tipo: mov.operacion.tipo as 'ingreso' | 'egreso' | 'division',
      clienteId: mov.operacion.clienteId,
      cliente: mov.operacion.cliente,
      depositoId: mov.operacion.depositoId,
      deposito: mov.operacion.deposito,
      numeroRemito: mov.operacion.numeroRemito,
      remitoUrl: mov.operacion.tipo === 'egreso' ? mov.operacion.remitoUrl : null,
      fotosUrls: [],
      entregadoPor: mov.operacion.entregadoPor,
      destinatario: mov.operacion.destinatario,
      destinoFinal: mov.operacion.destinoFinal,
      numeroDocumentoExterno: mov.operacion.numeroDocumentoExterno,
      cantidad1: mov.bultos,
      cantidad2: mov.unidades,
    }));

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

  private operacionListInclude() {
    return {
      cliente: { select: { id: true, nombre: true } },
      deposito: { select: { id: true, nombre: true } },
      movimientos: {
        select: {
          id: true,
          productoId: true,
          producto: {
            select: {
              id: true,
              nombre: true,
            },
          },
          presentacionId: true,
          presentacion: {
            select: {
              id: true,
              unidadesPorBulto: true,
              presentacion: { select: { id: true, nombre: true } },
            },
          },
          bultos: true,
          unidades: true,
          lote: true,
          fechaVencimiento: true,
        },
      },
    } as const;
  }

  private mapOperacionRowForApi(
    op: {
      id: string;
      tenantId: string;
      tipo: string;
      fecha: Date;
      clienteId: string;
      cliente: { id: string; nombre: string };
      depositoId: string;
      deposito: { id: string; nombre: string };
      remitoUrl?: string | null;
      numeroRemito?: string | null;
      entregadoPor?: string | null;
      destinatario?: string | null;
      destinoFinal?: string | null;
      observaciones?: string | null;
      fotosUrls?: string[];
      createdBy: string;
      createdAt: Date;
      movimientos: Array<{
        id: string;
        productoId: string;
        producto: { id: string; nombre: string };
        presentacionId: string | null;
        presentacion: {
          id: string;
          unidadesPorBulto: number;
          presentacion: { id: string; nombre: string };
        } | null;
        bultos: number;
        unidades: number;
        lote: string | null;
        fechaVencimiento: Date | null;
      }>;
    },
  ) {
    return this.mapOperacionForApi({
      id: op.id,
      tenantId: op.tenantId,
      tipo: op.tipo,
      fecha: op.fecha.toISOString(),
      clienteId: op.clienteId,
      cliente: op.cliente,
      depositoId: op.depositoId,
      deposito: op.deposito,
      remitoUrl: op.remitoUrl,
      numeroRemito: op.numeroRemito,
      entregadoPor: op.entregadoPor,
      destinatario: op.destinatario,
      destinoFinal: op.destinoFinal,
      observaciones: op.observaciones,
      fotosUrls: op.fotosUrls,
      createdBy: op.createdBy,
      createdAt: op.createdAt.toISOString(),
      movimientos: op.movimientos.map((m) => ({
        ...m,
        fechaVencimiento: m.fechaVencimiento?.toISOString() ?? null,
      })),
    });
  }

  /** Listado consolidado: una fila por operación (cabecera) con todas sus líneas de producto. */
  async listOperacionesPaginated(
    tenantId: string,
    query: PaginationQueryDto,
    productoId?: string,
    clienteId?: string,
    options?: {
      depositoId?: string;
      tipo?: 'ingreso' | 'egreso' | 'division';
      fechaDesde?: string;
      fechaHasta?: string;
      createdBy?: string;
      /** Filtro por lote (`__sin_lote__` = stock sin lote asignado). */
      lote?: string;
    },
  ) {
    const { depositoId, tipo, fechaDesde, fechaHasta, createdBy, lote } = options ?? {};
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const desde = fechaDesde ? parseYyyyMmDdInicioAr(fechaDesde) : null;
    const hasta = fechaHasta ? parseYyyyMmDdFinAr(fechaHasta) : null;

    const loteTrim = lote?.trim();
    const filtroLote =
      loteTrim === undefined || loteTrim === ''
        ? undefined
        : loteTrim === '__sin_lote__'
          ? null
          : loteTrim;

    const movimientoSome =
      productoId || filtroLote !== undefined
        ? {
            some: {
              ...(productoId ? { productoId } : {}),
              ...(filtroLote !== undefined ? { lote: filtroLote } : {}),
            },
          }
        : undefined;

    const where = {
      tenantId,
      ...(clienteId ? { clienteId } : {}),
      ...(depositoId ? { depositoId } : {}),
      ...(tipo ? { tipo } : {}),
      ...(createdBy ? { createdBy } : {}),
      ...(movimientoSome ? { movimientos: movimientoSome } : {}),
      ...(desde || hasta
        ? {
            fecha: {
              ...(desde ? { gte: desde } : {}),
              ...(hasta ? { lte: hasta } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockOperacion.count({ where }),
      this.prisma.stockOperacion.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.operacionListInclude(),
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const items = rows.map((op) => this.mapOperacionRowForApi(op));

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

  async findOperacion(id: string, tenantId: string) {
    const op = await this.prisma.stockOperacion.findFirst({
      where: { id, tenantId },
      include: this.operacionListInclude(),
    });
    if (!op) throw new NotFoundException('Operación no encontrada.');
    return this.mapOperacionRowForApi(op);
  }

  async findMovimiento(id: string, tenantId: string) {
    const INCLUDE = {
      producto: { select: { id: true, nombre: true } },
      presentacion: {
        select: {
          id: true,
          unidadesPorBulto: true,
          presentacion: { select: { id: true, nombre: true } },
        },
      },
      operacion: {
        select: {
          id: true,
          clienteId: true,
          cliente: { select: { id: true, nombre: true } },
          depositoId: true,
          deposito: { select: { id: true, nombre: true } },
          tipo: true,
          observaciones: true,
          numeroRemito: true,
          remitoUrl: true,
          fotosUrls: true,
          entregadoPor: true,
          destinatario: true,
          destinoFinal: true,
          numeroDocumentoExterno: true,
          createdBy: true,
          createdAt: true,
        },
      },
    } as const;

    // Acepta tanto movimientoStock.id (modelo viejo) como StockOperacion.id
    const mov =
      (await this.prisma.movimientoStock.findFirst({ where: { id, tenantId }, include: INCLUDE })) ??
      (await this.prisma.movimientoStock.findFirst({ where: { operacionId: id, tenantId }, include: INCLUDE }));

    if (!mov) throw new NotFoundException('Movimiento no encontrado.');

    const createdByLabel = await this.clerkUsers.getUserDisplayLabel(mov.operacion.createdBy);

    return {
      id: mov.id,
      tenantId: mov.tenantId,
      operacionId: mov.operacionId,
      productoId: mov.productoId,
      producto: mov.producto,
      presentacionId: mov.presentacionId,
      presentacion: mov.presentacion,
      bultos: mov.bultos,
      unidades: mov.unidades,
      fechaVencimiento: mov.fechaVencimiento?.toISOString() ?? null,
      lote: mov.lote,
      observaciones: mov.observaciones ?? mov.operacion.observaciones ?? null,
      movimientoVinculadoId: mov.movimientoVinculadoId,
      createdBy: mov.operacion.createdBy,
      createdByLabel,
      fecha: mov.fecha.toISOString(),
      createdAt: mov.operacion.createdAt.toISOString(),
      tipo: mov.operacion.tipo as 'ingreso' | 'egreso' | 'division',
      clienteId: mov.operacion.clienteId,
      cliente: mov.operacion.cliente,
      depositoId: mov.operacion.depositoId,
      deposito: mov.operacion.deposito,
      numeroRemito: mov.operacion.numeroRemito,
      remitoUrl: mov.operacion.tipo === 'egreso' ? mov.operacion.remitoUrl : null,
      fotosUrls: [],
      entregadoPor: mov.operacion.entregadoPor,
      destinatario: mov.operacion.destinatario,
      destinoFinal: mov.operacion.destinoFinal,
      numeroDocumentoExterno: mov.operacion.numeroDocumentoExterno,
      cantidad1: mov.bultos,
      cantidad2: mov.unidades,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createMovimiento(tenantId: string, dto: CreateMovimientoStockDto) {
    throw new ServiceUnavailableException(STUB_MSG);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateMovimiento(id: string, tenantId: string, dto: UpdateMovimientoStockDto) {
    throw new ServiceUnavailableException(STUB_MSG);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async removeMovimiento(id: string, tenantId: string) {
    throw new ServiceUnavailableException(STUB_MSG);
  }

  // ───────────────── FOTOS DE INGRESO ─────────────────────────────────────

  async uploadIngresoFoto(tenantId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Se requiere una imagen.');
    const name = file.originalname.toLowerCase();
    const isImage = file.mimetype.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
    if (!isImage) throw new BadRequestException('Solo se permiten imágenes JPG o PNG.');
    if (file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException('La imagen no puede superar 10 MB.');
    const url = await this.cloudinary.uploadIngresoFoto(tenantId, file.buffer, file.originalname, file.mimetype);
    return { url };
  }

  /** @deprecated Usar uploadIngresoFoto */
  async uploadRemitoPdf(tenantId: string, file: Express.Multer.File) {
    return this.uploadIngresoFoto(tenantId, file);
  }

  async streamRemitoAdjunto(id: string, tenantId: string, res: Response) {
    const mov = await this.prisma.movimientoStock.findFirst({
      where: { id, tenantId },
      select: { operacionId: true, operacion: { select: { tipo: true } } },
    });
    if (!mov) throw new NotFoundException('Movimiento no encontrado.');
    if (mov.operacion.tipo !== 'egreso') {
      throw new NotFoundException('Solo los egresos tienen remito PDF.');
    }
    return this.streamRemitoInternoView(mov.operacionId, tenantId, res);
  }

  async streamRemitoInternoView(egresoId: string, tenantId: string, res: Response) {
    const { buffer, filename } = await this.fetchRemitoInternoPdfBuffer(egresoId, tenantId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    });
    res.send(buffer);
  }

  private async fetchRemitoInternoPdfBuffer(
    egresoId: string,
    tenantId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { url } = await this.ensureRemitoInternoPdf(egresoId, tenantId);
    const op = await this.prisma.stockOperacion.findFirst({
      where: { id: egresoId, tenantId, tipo: 'egreso' },
      select: { numeroRemito: true },
    });
    const fetched = await fetch(url);
    if (!fetched.ok) {
      throw new ServiceUnavailableException('No se pudo obtener el remito PDF.');
    }
    const buffer = Buffer.from(await fetched.arrayBuffer());
    const filename = `remito-${op?.numeroRemito ?? egresoId}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, '-');
    return { buffer, filename };
  }

  private isRemitoInternoPdfUrl(url: string): boolean {
    return /remito-interno/i.test(url) || /remitos-internos/i.test(url);
  }

  private mapOperacionForApi<T extends { tipo: string; remitoUrl?: string | null; fotosUrls?: string[] }>(
    op: T,
  ): T {
    if (op.tipo === 'ingreso') return { ...op, remitoUrl: null };
    if (op.tipo === 'egreso') return { ...op, fotosUrls: [] };
    return op;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ INGRESOS / EGRESOS / DIVISIONES (pendientes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async createIngreso(tenantId: string, dto: CreateIngresoDto, createdBy: string) {
    const [cliente, deposito] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
      this.prisma.deposito.findFirst({ where: { id: dto.depositoId, tenantId, activo: true } }),
    ]);
    if (!cliente) throw new BadRequestException('Cliente inválido.');
    if (!deposito) throw new BadRequestException('Depósito inválido o inactivo.');

    for (const linea of dto.lineas) {
      if (linea.bultos <= 0 && linea.sueltas <= 0) {
        throw new BadRequestException('Cada línea debe tener bultos o sueltas mayor a 0.');
      }
      const pp = await this.prisma.productoPresentacion.findFirst({
        where: { id: linea.presentacionId, productoId: linea.productoId, tenantId, activo: true },
      });
      if (!pp) {
        throw new BadRequestException('Presentación inválida para uno de los productos seleccionados.');
      }
    }

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida.');

    return this.prisma.$transaction(async (tx) => {
      const operacion = await tx.stockOperacion.create({
        data: {
          tenantId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
          tipo: 'ingreso',
          fecha: fechaMov,
          fotosUrls: dto.fotosUrls.map((u) => u.trim()),
          observaciones: dto.observaciones?.trim() || null,
          numeroRemitoProveedor: dto.numeroRemitoProveedor?.trim() || null,
          createdBy,
        },
      });

      for (const linea of dto.lineas) {
        const fechaVencimiento = parseFechaMovimientoStock(linea.fechaVencimiento);
        const lote = resolverLoteIngreso(linea);

        await tx.movimientoStock.create({
          data: {
            tenantId,
            operacionId: operacion.id,
            productoId: linea.productoId,
            presentacionId: linea.presentacionId,
            bultos: linea.bultos,
            unidades: linea.sueltas,
            fechaVencimiento,
            lote,
            fecha: fechaMov,
            createdBy,
          },
        });

        await tx.stockItem.upsert({
          where: {
            productoId_presentacionId_clienteId_depositoId: {
              productoId: linea.productoId,
              presentacionId: linea.presentacionId,
              clienteId: dto.clienteId,
              depositoId: dto.depositoId,
            },
          },
          update: {
            cantidad1: { increment: linea.bultos },
            cantidad2: { increment: linea.sueltas },
          },
          create: {
            tenantId,
            productoId: linea.productoId,
            presentacionId: linea.presentacionId,
            clienteId: dto.clienteId,
            depositoId: dto.depositoId,
            cantidad1: linea.bultos,
            cantidad2: linea.sueltas,
          },
        });
      }

      return { id: operacion.id, movimientosCount: dto.lineas.length };
    });
  }

  async listIngresos(
    tenantId: string,
    query: PaginationQueryDto,
    clienteId?: string,
    productoId?: string,
    depositoId?: string,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const desde = fechaDesde ? parseYyyyMmDdInicioAr(fechaDesde) : null;
    const hasta = fechaHasta ? parseYyyyMmDdFinAr(fechaHasta) : null;

    const where = {
      tenantId,
      tipo: 'ingreso' as const,
      ...(clienteId ? { clienteId } : {}),
      ...(depositoId ? { depositoId } : {}),
      ...(productoId ? { movimientos: { some: { productoId } } } : {}),
      ...(desde || hasta
        ? {
            fecha: {
              ...(desde ? { gte: desde } : {}),
              ...(hasta ? { lte: hasta } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockOperacion.count({ where }),
      this.prisma.stockOperacion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          cliente: { select: { id: true, nombre: true } },
          deposito: { select: { id: true, nombre: true } },
          movimientos: {
            select: {
              id: true,
              productoId: true,
              producto: {
            select: {
              id: true,
              nombre: true,
            },
          },
              presentacionId: true,
              presentacion: {
                select: {
                  id: true,
                  unidadesPorBulto: true,
                  presentacion: { select: { id: true, nombre: true } },
                },
              },
              bultos: true,
              unidades: true,
              lote: true,
              fechaVencimiento: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      items: rows.map((op) => this.mapOperacionForApi(op)),
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

  async createEgreso(tenantId: string, dto: CreateEgresoDto, createdBy: string) {
    const [cliente, deposito] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
      this.prisma.deposito.findFirst({ where: { id: dto.depositoId, tenantId, activo: true } }),
    ]);
    if (!cliente) throw new BadRequestException('Cliente inválido.');
    if (!deposito) throw new BadRequestException('Depósito inválido o inactivo.');

    for (const linea of dto.lineas) {
      if (linea.bultos <= 0 && linea.sueltas <= 0) {
        throw new BadRequestException('Cada línea debe tener bultos o sueltas mayor a 0.');
      }
      const pp = await this.prisma.productoPresentacion.findFirst({
        where: { id: linea.presentacionId, productoId: linea.productoId, tenantId, activo: true },
      });
      if (!pp) {
        throw new BadRequestException('Presentación inválida para uno de los productos seleccionados.');
      }
    }

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida.');

    const config = await this.getEgresoRemitoConfig(tenantId);
    const year = yearInBuenosAires(fechaMov);

    return this.prisma.$transaction(async (tx) => {
      const seq = await this.nextSecuenciaRemitoTx(tx, tenantId, year);
      const numeroRemito = this.formatoNumeroRemito(config.remitoPrefix, year, seq, config.remitoDigitos);

      const operacion = await tx.stockOperacion.create({
        data: {
          tenantId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
          tipo: 'egreso',
          fecha: fechaMov,
          numeroRemito,
          entregadoPor: dto.entregadoPor?.trim() || null,
          destinatario: dto.destinatario?.trim() || null,
          destinoFinal: dto.destinoFinal?.trim() || null,
          numeroDocumentoExterno: dto.numeroDocumentoExterno.trim(),
          observaciones: dto.observaciones?.trim() || null,
          createdBy,
        },
      });

      for (const linea of dto.lineas) {
        const { lote, fechaVencimiento } = await this.validarLineaEgresoConLote(
          tenantId,
          dto.clienteId,
          dto.depositoId,
          linea,
        );

        await tx.movimientoStock.create({
          data: {
            tenantId,
            operacionId: operacion.id,
            productoId: linea.productoId,
            presentacionId: linea.presentacionId,
            bultos: linea.bultos,
            unidades: linea.sueltas,
            lote,
            fechaVencimiento,
            fecha: fechaMov,
            createdBy,
          },
        });

        const stockKey = {
          productoId: linea.productoId,
          presentacionId: linea.presentacionId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
        };

        const stockItem = await tx.stockItem.findUnique({
          where: { productoId_presentacionId_clienteId_depositoId: stockKey },
        });

        if (!stockItem) {
          throw new BadRequestException(
            'No hay stock del producto seleccionado en el depósito indicado.',
          );
        }
        if (stockItem.cantidad1 < linea.bultos) {
          throw new BadRequestException(
            `Stock insuficiente de bultos para uno de los productos. Disponible: ${stockItem.cantidad1}.`,
          );
        }
        if (stockItem.cantidad2 < linea.sueltas) {
          throw new BadRequestException(
            `Stock insuficiente de sueltas para uno de los productos. Disponible: ${stockItem.cantidad2}.`,
          );
        }

        const updated = await tx.stockItem.update({
          where: { productoId_presentacionId_clienteId_depositoId: stockKey },
          data: {
            cantidad1: { decrement: linea.bultos },
            cantidad2: { decrement: linea.sueltas },
          },
        });

        if (updated.cantidad1 < 0) {
          throw new BadRequestException(`Stock insuficiente de bultos para uno de los productos.`);
        }
        if (updated.cantidad2 < 0) {
          throw new BadRequestException(`Stock insuficiente de sueltas para uno de los productos.`);
        }
      }

      return { id: operacion.id, numeroRemito, movimientosCount: dto.lineas.length };
    }).then(async (result) => {
      try {
        await this.ensureRemitoInternoPdf(result.id, tenantId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`No se pudo generar el remito PDF al crear egreso ${result.id}: ${msg}`);
      }
      return result;
    });
  }

  private egresoOperacionInclude() {
    return {
      cliente: { select: { id: true, nombre: true } },
      deposito: { select: { id: true, nombre: true } },
      movimientos: {
        select: {
          id: true,
          productoId: true,
          producto: {
            select: {
              id: true,
              nombre: true,
            },
          },
          presentacionId: true,
          presentacion: {
            select: {
              id: true,
              unidadesPorBulto: true,
              presentacion: { select: { id: true, nombre: true } },
            },
          },
          bultos: true,
          unidades: true,
          lote: true,
          fechaVencimiento: true,
        },
      },
    } as const;
  }

  async findEgreso(id: string, tenantId: string) {
    const op = await this.prisma.stockOperacion.findFirst({
      where: { id, tenantId, tipo: 'egreso' },
      include: this.egresoOperacionInclude(),
    });
    if (!op) throw new NotFoundException('Egreso no encontrado.');
    return this.mapOperacionForApi(op);
  }

  async ensureRemitoInternoPdf(egresoId: string, tenantId: string) {
    const op = await this.prisma.stockOperacion.findFirst({
      where: { id: egresoId, tenantId, tipo: 'egreso' },
      select: { id: true, remitoUrl: true, numeroRemito: true },
    });
    if (!op) throw new NotFoundException('Egreso no encontrado.');

    const existing = op.remitoUrl?.trim();
    if (existing && this.isRemitoInternoPdfUrl(existing)) {
      this.cloudinary.assertRemitoUrlForTenant(existing, tenantId);
      return {
        url: this.cloudinary.resolveDeliveryUrl(existing),
        generated: false,
      };
    }

    const buffer = await this.remitoInternoPdf.generate(tenantId, egresoId);
    const slug = (op.numeroRemito ?? egresoId).replace(/[^a-zA-Z0-9_-]+/g, '-');
    const storedUrl = await this.cloudinary.uploadRemitoInternoPdf(
      tenantId,
      buffer,
      `remito-interno-${slug}.pdf`,
    );

    await this.prisma.stockOperacion.update({
      where: { id: egresoId },
      data: { remitoUrl: storedUrl },
    });

    return {
      url: this.cloudinary.resolveDeliveryUrl(storedUrl),
      generated: true,
    };
  }

  async listEgresos(
    tenantId: string,
    query: PaginationQueryDto,
    clienteId?: string,
    productoId?: string,
    depositoId?: string,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const desde = fechaDesde ? parseYyyyMmDdInicioAr(fechaDesde) : null;
    const hasta = fechaHasta ? parseYyyyMmDdFinAr(fechaHasta) : null;

    const where = {
      tenantId,
      tipo: 'egreso' as const,
      ...(clienteId ? { clienteId } : {}),
      ...(depositoId ? { depositoId } : {}),
      ...(productoId ? { movimientos: { some: { productoId } } } : {}),
      ...(desde || hasta
        ? {
            fecha: {
              ...(desde ? { gte: desde } : {}),
              ...(hasta ? { lte: hasta } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockOperacion.count({ where }),
      this.prisma.stockOperacion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.egresoOperacionInclude(),
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      items: rows.map((op) => this.mapOperacionForApi(op)),
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

  async createDivision(tenantId: string, dto: CreateDivisionDto, createdBy: string) {
    const [cliente, deposito] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
      this.prisma.deposito.findFirst({ where: { id: dto.depositoId, tenantId, activo: true } }),
    ]);
    if (!cliente) throw new BadRequestException('Cliente no encontrado.');
    if (!deposito) throw new BadRequestException('Depósito no encontrado o inactivo.');

    const pp = await this.prisma.productoPresentacion.findFirst({
      where: { id: dto.presentacionId, tenantId, productoId: dto.productoId, activo: true },
    });
    if (!pp) throw new BadRequestException('Presentación no encontrada para este producto.');
    if (!pp.unidadesPorBulto || pp.unidadesPorBulto <= 0) {
      throw new BadRequestException(
        'La presentación no tiene unidades por bulto configuradas. No se puede realizar la división.',
      );
    }

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    const unidadesGeneradas = dto.bultos * pp.unidadesPorBulto;
    const stockKey = {
      productoId: dto.productoId,
      presentacionId: dto.presentacionId,
      clienteId: dto.clienteId,
      depositoId: dto.depositoId,
    };

    return this.prisma.$transaction(async (tx) => {
      const stockItem = await tx.stockItem.findUnique({
        where: { productoId_presentacionId_clienteId_depositoId: stockKey },
      });
      if (!stockItem || stockItem.cantidad1 < dto.bultos) {
        throw new BadRequestException(
          `Stock insuficiente. Disponible: ${stockItem?.cantidad1 ?? 0} bulto(s), solicitado: ${dto.bultos}.`,
        );
      }

      const operacion = await tx.stockOperacion.create({
        data: {
          tenantId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
          tipo: 'division',
          fecha: fechaMov,
          observaciones: dto.observaciones,
          createdBy,
        },
      });

      const lote = dto.lote?.trim() || null;

      // Movimiento A: los bultos que se convierten
      const movA = await tx.movimientoStock.create({
        data: {
          tenantId,
          operacionId: operacion.id,
          productoId: dto.productoId,
          presentacionId: dto.presentacionId,
          bultos: dto.bultos,
          unidades: 0,
          lote,
          fecha: fechaMov,
          createdBy,
        },
      });

      // Movimiento B: las sueltas generadas, vinculado a A
      const movB = await tx.movimientoStock.create({
        data: {
          tenantId,
          operacionId: operacion.id,
          productoId: dto.productoId,
          presentacionId: dto.presentacionId,
          bultos: 0,
          unidades: unidadesGeneradas,
          lote,
          movimientoVinculadoId: movA.id,
          fecha: fechaMov,
          createdBy,
        },
      });

      // Enlazar A → B
      await tx.movimientoStock.update({
        where: { id: movA.id },
        data: { movimientoVinculadoId: movB.id },
      });

      const updated = await tx.stockItem.update({
        where: { productoId_presentacionId_clienteId_depositoId: stockKey },
        data: {
          cantidad1: { decrement: dto.bultos },
          cantidad2: { increment: unidadesGeneradas },
        },
      });

      if (updated.cantidad1 < 0) {
        throw new BadRequestException('Stock insuficiente de bultos (verificación post-transacción).');
      }

      return { id: operacion.id, bultosRestados: dto.bultos, unidadesGeneradas };
    });
  }

  async listDivisiones(
    tenantId: string,
    query: PaginationQueryDto,
    clienteId?: string,
    productoId?: string,
    depositoId?: string,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const desde = fechaDesde ? parseYyyyMmDdInicioAr(fechaDesde) : null;
    const hasta = fechaHasta ? parseYyyyMmDdFinAr(fechaHasta) : null;

    const where = {
      tenantId,
      tipo: 'division' as const,
      ...(clienteId ? { clienteId } : {}),
      ...(depositoId ? { depositoId } : {}),
      ...(productoId ? { movimientos: { some: { productoId } } } : {}),
      ...(desde || hasta
        ? {
            fecha: {
              ...(desde ? { gte: desde } : {}),
              ...(hasta ? { lte: hasta } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockOperacion.count({ where }),
      this.prisma.stockOperacion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          cliente: { select: { id: true, nombre: true } },
          deposito: { select: { id: true, nombre: true } },
          movimientos: {
            select: {
              id: true,
              productoId: true,
              producto: {
            select: {
              id: true,
              nombre: true,
            },
          },
              presentacionId: true,
              presentacion: {
                select: {
                  id: true,
                  unidadesPorBulto: true,
                  presentacion: { select: { id: true, nombre: true } },
                },
              },
              bultos: true,
              unidades: true,
              movimientoVinculadoId: true,
            },
          },
        },
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

  listStockDisponible(tenantId: string, clienteId?: string, productoId?: string, depositoId?: string) {
    return this.prisma.stockItem.findMany({
      where: {
        tenantId,
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
        ...(depositoId ? { depositoId } : {}),
        OR: [{ cantidad1: { gt: 0 } }, { cantidad2: { gt: 0 } }],
      },
      orderBy: [{ clienteId: 'asc' }, { productoId: 'asc' }],
      include: stockItemRelations,
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CONFIG NÚMERO DE REMITO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getLotesDisponibles(
    tenantId: string,
    productoId: string,
    clienteId: string,
    depositoId: string,
    presentacionId?: string,
  ) {
    const rows = await this.fetchMovimientosParaSaldoLote(
      tenantId,
      productoId,
      clienteId,
      depositoId,
      presentacionId,
    );
    const { lotes, sinLote } = this.buildSaldosPorLote(rows);

    const lotesDisponibles = Array.from(lotes.entries())
      .filter(([, s]) => s.bultos > 0 || s.sueltas > 0)
      .map(([lote, s]) => ({
        lote,
        cantidad1: s.bultos,
        cantidad2: s.sueltas,
        fechaVencimiento: s.fechaVencimiento?.toISOString() ?? null,
      }))
      .sort((a, b) => a.lote.localeCompare(b.lote));

    const sinLoteDisponible =
      sinLote.bultos > 0 || sinLote.sueltas > 0
        ? { cantidad1: Math.max(0, sinLote.bultos), cantidad2: Math.max(0, sinLote.sueltas) }
        : null;

    return { lotes: lotesDisponibles, sinLote: sinLoteDisponible };
  }

  private async fetchMovimientosParaSaldoLote(
    tenantId: string,
    productoId: string,
    clienteId: string,
    depositoId: string,
    presentacionId?: string,
  ) {
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        productoId,
        ...(presentacionId ? { presentacionId } : {}),
        operacion: { clienteId, depositoId },
      },
      select: {
        lote: true,
        bultos: true,
        unidades: true,
        fechaVencimiento: true,
        fecha: true,
        operacion: { select: { tipo: true } },
      },
    });
  }

  private buildSaldosPorLote(
    rows: Array<{
      lote: string | null;
      bultos: number;
      unidades: number;
      fechaVencimiento: Date | null;
      fecha: Date;
      operacion: { tipo: string };
    }>,
  ) {
    const lotes = new Map<string, { bultos: number; sueltas: number; fechaVencimiento: Date | null }>();
    let sinBultos = 0;
    let sinSueltas = 0;
    const vencimientoReciente = new Map<string, { fecha: Date; venc: Date }>();

    for (const row of rows) {
      const sign = row.operacion.tipo === 'ingreso' ? 1 : -1;
      if (!row.lote) {
        sinBultos += sign * row.bultos;
        sinSueltas += sign * row.unidades;
        continue;
      }
      const key = row.lote;
      const prev = lotes.get(key) ?? { bultos: 0, sueltas: 0, fechaVencimiento: null };
      prev.bultos += sign * row.bultos;
      prev.sueltas += sign * row.unidades;
      lotes.set(key, prev);

      if (row.operacion.tipo === 'ingreso' && row.fechaVencimiento) {
        const cur = vencimientoReciente.get(key);
        if (!cur || row.fecha > cur.fecha) {
          vencimientoReciente.set(key, { fecha: row.fecha, venc: row.fechaVencimiento });
        }
      }
    }

    for (const [key, saldo] of lotes) {
      const v = vencimientoReciente.get(key);
      if (v) saldo.fechaVencimiento = v.venc;
    }

    return { lotes, sinLote: { bultos: sinBultos, sueltas: sinSueltas } };
  }

  private async validarLineaEgresoConLote(
    tenantId: string,
    clienteId: string,
    depositoId: string,
    linea: { productoId: string; presentacionId: string; bultos: number; sueltas: number; lote?: string | null; fechaVencimiento?: string },
  ): Promise<{ lote: string | null; fechaVencimiento: Date | null }> {
    if (linea.lote === undefined) {
      throw new BadRequestException('Cada línea debe indicar un lote o «Sin lote».');
    }

    const rows = await this.fetchMovimientosParaSaldoLote(
      tenantId,
      linea.productoId,
      clienteId,
      depositoId,
      linea.presentacionId,
    );
    const { lotes, sinLote } = this.buildSaldosPorLote(rows);

    const loteKey = linea.lote === null ? null : linea.lote.trim();
    if (loteKey === '') {
      throw new BadRequestException('El lote indicado no es válido.');
    }

    if (loteKey === null) {
      if (sinLote.bultos <= 0 && sinLote.sueltas <= 0) {
        throw new BadRequestException('No hay stock sin lote para uno de los productos seleccionados.');
      }
      if (linea.bultos > sinLote.bultos) {
        throw new BadRequestException(
          `Stock sin lote insuficiente en bultos. Disponible: ${Math.max(0, sinLote.bultos)}.`,
        );
      }
      if (linea.sueltas > sinLote.sueltas) {
        throw new BadRequestException(
          `Stock sin lote insuficiente en sueltas. Disponible: ${Math.max(0, sinLote.sueltas)}.`,
        );
      }
      return { lote: null, fechaVencimiento: null };
    }

    const saldoLote = lotes.get(loteKey);
    if (!saldoLote || (saldoLote.bultos <= 0 && saldoLote.sueltas <= 0)) {
      throw new BadRequestException(`No hay stock disponible para el lote «${loteKey}».`);
    }
    if (linea.bultos > saldoLote.bultos) {
      throw new BadRequestException(
        `Stock insuficiente en el lote «${loteKey}». Disponible: ${saldoLote.bultos} bulto(s).`,
      );
    }
    if (linea.sueltas > saldoLote.sueltas) {
      throw new BadRequestException(
        `Stock insuficiente en el lote «${loteKey}». Disponible: ${saldoLote.sueltas} suelta(s).`,
      );
    }

    let fechaVencimiento = saldoLote.fechaVencimiento;
    if (linea.fechaVencimiento?.trim()) {
      const parsed = parseFechaMovimientoStock(linea.fechaVencimiento);
      if (!isNaN(parsed.getTime())) fechaVencimiento = parsed;
    }

    return { lote: loteKey, fechaVencimiento };
  }

  async getLotesHistorico(
    tenantId: string,
    productoId: string,
    clienteId: string,
    depositoId: string,
    presentacionId?: string,
  ): Promise<string[]> {
    const rows = await this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        productoId,
        ...(presentacionId ? { presentacionId } : {}),
        lote: { not: null },
        operacion: { clienteId, depositoId, tipo: 'ingreso' },
      },
      select: { lote: true },
      distinct: ['lote'],
      orderBy: { fecha: 'desc' },
    });
    return rows.map((r) => r.lote!).filter(Boolean);
  }

  async getEgresoRemitoConfig(tenantId: string) {
    const row = await this.prisma.stockEgresoRemitoConfig.findUnique({
      where: { tenantId },
      select: { remitoPrefix: true, remitoDigitos: true },
    });
    return {
      remitoPrefix: row?.remitoPrefix?.trim() || 'R',
      remitoDigitos: row?.remitoDigitos ?? 5,
    };
  }

  async upsertEgresoRemitoConfig(tenantId: string, dto: UpdateStockEgresoRemitoConfigDto) {
    const current = await this.getEgresoRemitoConfig(tenantId);
    const remitoPrefix = dto.remitoPrefix !== undefined ? dto.remitoPrefix.trim() : current.remitoPrefix;
    const remitoDigitos = dto.remitoDigitos !== undefined ? dto.remitoDigitos : current.remitoDigitos;
    return this.prisma.stockEgresoRemitoConfig.upsert({
      where: { tenantId },
      create: { tenantId, remitoPrefix, remitoDigitos },
      update: { remitoPrefix, remitoDigitos },
      select: { remitoPrefix: true, remitoDigitos: true },
    });
  }

  private formatoNumeroRemito(prefix: string, year: number, seq: number, digitos: number) {
    const p = (prefix || 'R').trim() || 'R';
    const d = Math.min(12, Math.max(3, digitos || 5));
    return `${p}-${year}-${String(seq).padStart(d, '0')}`;
  }

  private async nextSecuenciaRemitoTx(tx: Prisma.TransactionClient, tenantId: string, year: number) {
    const id = randomUUID().replace(/-/g, '').slice(0, 25);
    const rows = await tx.$queryRaw<{ lastValue: number }[]>(
      Prisma.sql`
        INSERT INTO "stock_remito_secuencias" ("id", "tenantId", "year", "lastValue")
        VALUES (${id}, ${tenantId}, ${year}, 1)
        ON CONFLICT ("tenantId", "year")
        DO UPDATE SET "lastValue" = "stock_remito_secuencias"."lastValue" + 1
        RETURNING "lastValue"
      `,
    );
    const n = rows[0]?.lastValue;
    if (n === undefined || n === null) throw new BadRequestException('No se pudo generar el número de remito.');
    return n;
  }

}
