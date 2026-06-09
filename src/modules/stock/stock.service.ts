import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
import { parseFechaMovimientoStock, yearInBuenosAires } from './stock-fecha.util';

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
  codigo: true,
  descripcion: true,
  presentacion1Id: true,
  presentacion2Id: true,
  unidad1Nombre: true,
  unidad2Nombre: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
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
  unidad1Nombre: true,
  unidad2Nombre: true,
} as const;

const movimientoStockRelations = {
  producto: { select: productoMiniSelect },
  cliente: { select: { id: true, nombre: true } },
  deposito: { select: { id: true, nombre: true } },
} as const;

const stockItemRelations = {
  producto: { select: productoMiniSelect },
  cliente: { select: { id: true, nombre: true } },
  deposito: { select: { id: true, nombre: true } },
} as const;

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clerkUsers: ClerkVialtoRoleService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ───────────────── PRODUCTOS ──────────────────────────────────────────────

  async findAllProductosPaginated(tenantId: string, query: ProductosPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.ProductoWhereInput = { tenantId };

    const q = query.q?.trim();
    if (q) {
      where.nombre = { contains: q, mode: 'insensitive' };
    }

    const codigoQ = query.codigo?.trim();
    if (codigoQ) {
      where.codigo = { contains: codigoQ, mode: 'insensitive' };
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

  private async resolvePresentacionesProducto(
    tenantId: string,
    presentacion1Id: string,
    presentacion2Id?: string | null,
  ) {
    const p1 = await this.prisma.presentacion.findFirst({
      where: { id: presentacion1Id, tenantId, activo: true },
    });
    if (!p1) throw new BadRequestException('Presentación de cantidad 1 inválida o inactiva.');

    if (!presentacion2Id) {
      return { presentacion1Id: p1.id, presentacion2Id: null, unidad1Nombre: p1.nombre, unidad2Nombre: null };
    }

    const p2 = await this.prisma.presentacion.findFirst({
      where: { id: presentacion2Id, tenantId, activo: true },
    });
    if (!p2) throw new BadRequestException('Presentación de cantidad 2 inválida o inactiva.');

    return {
      presentacion1Id: p1.id,
      presentacion2Id: p2.id,
      unidad1Nombre: p1.nombre,
      unidad2Nombre: p2.nombre,
    };
  }

  async createProducto(tenantId: string, dto: CreateProductoDto) {
    const nombre = displayNombre(dto.nombre);
    if (!nombre) throw new ConflictException('El nombre no puede quedar vacío.');
    const nombreNormalizado = normalizarNombre(nombre);
    const pres = await this.resolvePresentacionesProducto(
      tenantId,
      dto.presentacion1Id,
      dto.presentacion2Id ?? null,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const codigo = await this.nextProductoCodigoTx(tx, tenantId);
        return tx.producto.create({
          data: {
            tenantId,
            nombre,
            nombreNormalizado,
            codigo,
            descripcion: dto.descripcion?.trim() || null,
            presentacion1Id: pres.presentacion1Id,
            presentacion2Id: pres.presentacion2Id,
            unidad1Nombre: pres.unidad1Nombre,
            unidad2Nombre: pres.unidad2Nombre,
            activo: dto.activo ?? true,
          },
          select: productoSelect,
        });
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

    let presentacionPatch: {
      presentacion1Id?: string;
      presentacion2Id?: string | null;
      unidad1Nombre?: string;
      unidad2Nombre?: string | null;
    } = {};

    if (dto.presentacion1Id !== undefined || dto.presentacion2Id !== undefined) {
      const p1Id = dto.presentacion1Id ?? current.presentacion1Id;
      if (!p1Id) throw new BadRequestException('La presentación de cantidad 1 es obligatoria.');
      const p2Id =
        dto.presentacion2Id !== undefined ? dto.presentacion2Id : current.presentacion2Id;
      const pres = await this.resolvePresentacionesProducto(tenantId, p1Id, p2Id);
      presentacionPatch = pres;
    }

    try {
      return await this.prisma.producto.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre, nombreNormalizado } : {}),
          ...(dto.descripcion !== undefined
            ? { descripcion: dto.descripcion?.trim() || null }
            : {}),
          ...presentacionPatch,
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

  async listDepositos(tenantId: string, activo?: boolean) {
    return this.prisma.deposito.findMany({
      where: {
        tenantId,
        ...(activo !== undefined ? { activo } : {}),
      },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
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

  private async assertDeposito(tenantId: string, depositoId: string, requireActive = false) {
    const row = await this.prisma.deposito.findFirst({ where: { id: depositoId, tenantId } });
    if (!row) throw new BadRequestException('Depósito inválido');
    if (requireActive && !row.activo) throw new BadRequestException('Depósito inactivo');
    return row;
  }

  // ───────────────── PRESENTACIONES (catálogo por tenant) ────────────────────

  async listPresentaciones(tenantId: string, activo?: boolean) {
    return this.prisma.presentacion.findMany({
      where: {
        tenantId,
        ...(activo !== undefined ? { activo } : {}),
      },
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
        data: {
          tenantId,
          nombre,
          nombreNormalizado,
          activo: dto.activo ?? true,
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

  async updatePresentacion(id: string, tenantId: string, dto: UpdatePresentacionDto) {
    const current = await this.prisma.presentacion.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException('Presentación no encontrada');

    const nombre =
      dto.nombre !== undefined ? displayNombre(dto.nombre) : current.nombre;
    if (dto.nombre !== undefined && !nombre) {
      throw new ConflictException('El nombre no puede quedar vacío.');
    }
    const nombreNormalizado =
      dto.nombre !== undefined ? normalizarNombre(nombre) : current.nombreNormalizado;

    try {
      const updated = await this.prisma.presentacion.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre, nombreNormalizado } : {}),
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        },
        select: presentacionSelect,
      });

      if (dto.nombre !== undefined && nombre !== current.nombre) {
        await this.prisma.producto.updateMany({
          where: { tenantId, presentacion1Id: id },
          data: { unidad1Nombre: nombre },
        });
        await this.prisma.producto.updateMany({
          where: { tenantId, presentacion2Id: id },
          data: { unidad2Nombre: nombre },
        });
      }

      return updated;
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

    const [enCant1, enCant2] = await Promise.all([
      this.prisma.producto.count({ where: { tenantId, presentacion1Id: id } }),
      this.prisma.producto.count({ where: { tenantId, presentacion2Id: id } }),
    ]);
    if (enCant1 + enCant2 > 0) {
      throw new ConflictException(
        'No se puede eliminar: hay productos que usan esta presentación como cantidad 1 o 2.',
      );
    }

    return this.prisma.presentacion.delete({ where: { id } });
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

  listMovimientos(
    tenantId: string,
    productoId?: string,
    clienteId?: string,
    options?: { soloIngresoEgreso?: boolean; depositoId?: string },
  ) {
    const soloIe = options?.soloIngresoEgreso === true;
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        ...(soloIe ? { tipo: { in: ['ingreso', 'egreso'] } } : {}),
        ...(productoId ? { productoId } : {}),
        ...(clienteId ? { clienteId } : {}),
        ...(options?.depositoId ? { depositoId: options.depositoId } : {}),
      },
      orderBy: soloIe
        ? [{ fecha: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }, { fecha: 'desc' }],
      take: 500,
      include: movimientoStockRelations,
    });
  }

  async findMovimiento(id: string, tenantId: string) {
    const row = await this.prisma.movimientoStock.findFirst({
      where: { id, tenantId },
      include: movimientoStockRelations,
    });
    if (!row) throw new NotFoundException('Movimiento de stock no encontrado');
    const createdByLabel = await this.clerkUsers.getUserDisplayLabel(row.createdBy);
    return { ...row, createdByLabel };
  }

  async createMovimiento(tenantId: string, dto: CreateMovimientoStockDto) {
    await this.assertProductoCliente(tenantId, dto.productoId, dto.clienteId);
    await this.assertDeposito(tenantId, dto.depositoId, true);
    await this.assertRemito(tenantId, dto.remitoId);
    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (Number.isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida');

    const cantidad1 = dto.cantidad1 ?? 0;
    const cantidad2 = dto.cantidad2 ?? 0;
    if (cantidad1 <= 0 && cantidad2 <= 0) {
      throw new BadRequestException('Al menos uno de cantidad1 o cantidad2 debe ser mayor a 0.');
    }

    return this.prisma.movimientoStock.create({
      data: {
        tenantId,
        productoId: dto.productoId,
        clienteId: dto.clienteId,
        depositoId: dto.depositoId,
        tipo: dto.tipo,
        cantidad1,
        cantidad2,
        remitoId: dto.remitoId ?? null,
        fecha: fechaMov,
      },
    });
  }

  async updateMovimiento(id: string, tenantId: string, dto: UpdateMovimientoStockDto) {
    const cur = await this.findMovimiento(id, tenantId);
    const pid = dto.productoId ?? cur.productoId;
    const cid = dto.clienteId ?? cur.clienteId;
    const did = dto.depositoId ?? cur.depositoId;
    await this.assertProductoCliente(tenantId, pid, cid);
    if (did) {
      await this.assertDeposito(tenantId, did, true);
    }
    await this.assertRemito(tenantId, dto.remitoId);
    let fechaParsed: Date | undefined;
    if (dto.fecha !== undefined) {
      fechaParsed = parseFechaMovimientoStock(dto.fecha);
      if (Number.isNaN(fechaParsed.getTime())) throw new BadRequestException('Fecha inválida');
    }
    return this.prisma.movimientoStock.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...dto,
        fecha: fechaParsed,
      } as any,
    });
  }

  async removeMovimiento(id: string, tenantId: string) {
    await this.findMovimiento(id, tenantId);
    return this.prisma.movimientoStock.delete({ where: { id } });
  }

  // ───────────────── REMITO ESCANEADO (PDF) ───────────────────────────────────

  async uploadRemitoPdf(tenantId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Se requiere un archivo de remito.');
    }
    const name = file.originalname.toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    const isImage =
      file.mimetype.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
    if (!isPdf && !isImage) {
      throw new BadRequestException('El remito debe ser un PDF o una imagen.');
    }
    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('El archivo no puede superar 10 MB.');
    }

    const url = await this.cloudinary.uploadRemitoArchivo(
      tenantId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { url };
  }

  async streamRemitoAdjunto(id: string, tenantId: string, res: Response) {
    const row = await this.prisma.movimientoStock.findFirst({
      where: { id, tenantId },
      select: { remitoUrl: true },
    });
    if (!row?.remitoUrl?.trim()) {
      throw new NotFoundException('Este movimiento no tiene remito escaneado.');
    }

    const storedUrl = row.remitoUrl.trim();
    this.cloudinary.assertRemitoUrlForTenant(storedUrl, tenantId);

    const candidates = [storedUrl, this.cloudinary.resolveDeliveryUrl(storedUrl)];
    let upstream: globalThis.Response | null = null;
    let lastStatus = 0;

    for (const url of [...new Set(candidates)]) {
      const attempt = await fetch(url);
      lastStatus = attempt.status;
      if (attempt.ok && attempt.body) {
        upstream = attempt;
        break;
      }
    }

    if (!upstream?.body) {
      if (lastStatus === 401) {
        throw new ServiceUnavailableException(
          'Cloudinary bloquea la entrega de PDF. En el panel de Cloudinary → Settings → Security, activá “Allow delivery of PDF and ZIP files”.',
        );
      }
      throw new BadGatewayException('No se pudo obtener el remito escaneado.');
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');

    await pipeline(Readable.fromWeb(upstream.body as import('stream/web').ReadableStream), res);
  }

  // ───────────────── INGRESOS AL DEPÓSITO ───────────────────────────────────

  async createIngreso(tenantId: string, dto: CreateIngresoDto, createdBy: string) {
    const cantidad1 = dto.cantidad1 ?? 0;
    const cantidad2 = dto.cantidad2 ?? 0;
    if (cantidad1 <= 0 && cantidad2 <= 0) {
      throw new BadRequestException('Al menos uno de cantidad1 o cantidad2 debe ser mayor a 0.');
    }

    await this.assertDeposito(tenantId, dto.depositoId, true);

    const [producto, cliente] = await Promise.all([
      this.prisma.producto.findFirst({ where: { id: dto.productoId, tenantId } }),
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
    ]);
    if (!producto) throw new BadRequestException('Producto inválido');
    if (!cliente) throw new BadRequestException('Cliente inválido');

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (Number.isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida');

    const remitoUrl = dto.remitoEscaneadoUrl?.trim();
    if (!remitoUrl) {
      throw new BadRequestException('El remito es obligatorio.');
    }

    return this.prisma.$transaction(async (tx) => {
      const movimiento = await tx.movimientoStock.create({
        data: {
          tenantId,
          productoId: dto.productoId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
          tipo: 'ingreso',
          cantidad1,
          cantidad2,
          lote: dto.lote?.trim() || null,
          observaciones: dto.observaciones?.trim() || null,
          remitoUrl,
          createdBy,
          fecha: fechaMov,
        },
        include: {
          producto: { select: productoMiniSelect },
          cliente: { select: { id: true, nombre: true } },
          deposito: { select: { id: true, nombre: true } },
        },
      });

      await tx.stockItem.upsert({
        where: {
          productoId_clienteId_depositoId: {
            productoId: dto.productoId,
            clienteId: dto.clienteId,
            depositoId: dto.depositoId,
          },
        },
        update: {
          cantidad1: { increment: cantidad1 },
          cantidad2: { increment: cantidad2 },
        },
        create: {
          tenantId,
          productoId: dto.productoId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
          cantidad1,
          cantidad2,
        },
      });

      return movimiento;
    });
  }

  listIngresos(tenantId: string, clienteId?: string, productoId?: string, depositoId?: string) {
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        tipo: 'ingreso',
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
        ...(depositoId ? { depositoId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: movimientoStockRelations,
    });
  }

  listStockDisponible(tenantId: string, clienteId?: string, productoId?: string, depositoId?: string) {
    return this.prisma.stockItem.findMany({
      where: {
        tenantId,
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
        ...(depositoId ? { depositoId } : {}),
      },
      orderBy: [{ clienteId: 'asc' }, { productoId: 'asc' }],
      include: stockItemRelations,
    });
  }

  // ───────────────── CONFIG NÚMERO DE REMITO (EGRESOS) ───────────────────────

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

  /** Atómico dentro de la transacción: incrementa contador anual y devuelve el nuevo valor. */
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
    if (n === undefined || n === null) {
      throw new BadRequestException('No se pudo generar el número de remito.');
    }
    return n;
  }

  // ───────────────── EGRESOS (DESPACHO) ─────────────────────────────────────

  async createEgreso(tenantId: string, dto: CreateEgresoDto, createdBy: string) {
    const cantidad1 = dto.cantidad1 ?? 0;
    const cantidad2 = dto.cantidad2 ?? 0;
    if (cantidad1 <= 0 && cantidad2 <= 0) {
      throw new BadRequestException('Al menos uno de cantidad1 o cantidad2 debe ser mayor a 0.');
    }

    await this.assertDeposito(tenantId, dto.depositoId, true);

    const [producto, cliente] = await Promise.all([
      this.prisma.producto.findFirst({ where: { id: dto.productoId, tenantId } }),
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
    ]);
    if (!producto) throw new BadRequestException('Producto inválido');
    if (!cliente) throw new BadRequestException('Cliente inválido');

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (Number.isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida');

    const remitoUrl = dto.remitoEscaneadoUrl?.trim();
    if (!remitoUrl) {
      throw new BadRequestException('El remito es obligatorio.');
    }

    return this.prisma.$transaction(async (tx) => {
      const cfg = await tx.stockEgresoRemitoConfig.findUnique({
        where: { tenantId },
        select: { remitoPrefix: true, remitoDigitos: true },
      });
      const prefix = cfg?.remitoPrefix?.trim() || 'R';
      const digitos = cfg?.remitoDigitos ?? 5;

      const year = yearInBuenosAires(fechaMov);

      const item = await tx.stockItem.findUnique({
        where: {
          productoId_clienteId_depositoId: {
            productoId: dto.productoId,
            clienteId: dto.clienteId,
            depositoId: dto.depositoId,
          },
        },
      });

      const disp1 = item?.cantidad1 ?? 0;
      const disp2 = item?.cantidad2 ?? 0;

      if (cantidad1 > 0 && disp1 < cantidad1) {
        throw new BadRequestException(
          `Stock de pallets insuficiente para esta empresa y producto. Disponible: ${disp1}.`,
        );
      }
      if (cantidad2 > 0 && disp2 < cantidad2) {
        throw new BadRequestException(
          `Stock suelto insuficiente para esta empresa y producto. Disponible: ${disp2}.`,
        );
      }

      // Validación atómica con optimistic locking vía condición en updateMany
      const dec = await tx.stockItem.updateMany({
        where: {
          tenantId,
          productoId: dto.productoId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
          cantidad1: { gte: cantidad1 },
          cantidad2: { gte: cantidad2 },
        },
        data: {
          cantidad1: { decrement: cantidad1 },
          cantidad2: { decrement: cantidad2 },
        },
      });
      if (dec.count === 0) {
        throw new BadRequestException(
          `Stock insuficiente para esta empresa y producto. Pallets disponibles: ${disp1}, suelto disponible: ${disp2}.`,
        );
      }

      const seq = await this.nextSecuenciaRemitoTx(tx, tenantId, year);
      let numeroRemito = this.formatoNumeroRemito(prefix, year, seq, digitos);

      const tryCreate = async (numero: string) =>
        tx.movimientoStock.create({
          data: {
            tenantId,
            productoId: dto.productoId,
            clienteId: dto.clienteId,
            depositoId: dto.depositoId,
            tipo: 'egreso',
            cantidad1,
            cantidad2,
            numeroRemito: numero,
            lote: dto.lote?.trim() || null,
            observaciones: dto.observaciones?.trim() || null,
            entregadoPor: dto.entregadoPor?.trim() || null,
            destinatario: dto.destinatario?.trim() || null,
            destinoFinal: dto.destinoFinal?.trim() || null,
            remitoUrl,
            createdBy,
            fecha: fechaMov,
          },
          include: movimientoStockRelations,
        });

      try {
        return await tryCreate(numeroRemito);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const seqRetry = await this.nextSecuenciaRemitoTx(tx, tenantId, year);
          numeroRemito = this.formatoNumeroRemito(prefix, year, seqRetry, digitos);
          return await tryCreate(numeroRemito);
        }
        throw e;
      }
    });
  }

  listEgresos(tenantId: string, clienteId?: string, productoId?: string, depositoId?: string) {
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        tipo: 'egreso',
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
        ...(depositoId ? { depositoId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: movimientoStockRelations,
    });
  }

  // ───────────────── DIVISIONES ─────────────────────────────────────────────

  async createDivision(tenantId: string, dto: CreateDivisionDto, createdBy: string) {
    const cantidad1Origen = dto.cantidad1Origen ?? 0;
    const cantidad2Origen = dto.cantidad2Origen ?? 0;
    const cantidad1Destino = dto.cantidad1Destino ?? 0;
    const cantidad2Destino = dto.cantidad2Destino ?? 0;

    if (cantidad1Origen <= 0 && cantidad2Origen <= 0) {
      throw new BadRequestException('Al menos uno de cantidad1Origen o cantidad2Origen debe ser mayor a 0.');
    }
    if (cantidad1Destino <= 0 && cantidad2Destino <= 0) {
      throw new BadRequestException('Al menos uno de cantidad1Destino o cantidad2Destino debe ser mayor a 0.');
    }

    const [producto, cliente] = await Promise.all([
      this.prisma.producto.findFirst({ where: { id: dto.productoId, tenantId } }),
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
    ]);
    if (!producto) throw new BadRequestException('Producto inválido');
    if (!cliente) throw new BadRequestException('Cliente inválido');

    await this.assertDeposito(tenantId, dto.depositoId, true);

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (Number.isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida');

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({
        where: { productoId_clienteId_depositoId: { productoId: dto.productoId, clienteId: dto.clienteId, depositoId: dto.depositoId } },
      });

      const disp1 = item?.cantidad1 ?? 0;
      const disp2 = item?.cantidad2 ?? 0;

      const u1 = producto.unidad1Nombre?.trim() || 'Cantidad 1';
      const u2 = producto.unidad2Nombre?.trim() || 'Cantidad 2';

      if (cantidad1Origen > 0 && disp1 < cantidad1Origen) {
        throw new BadRequestException(`Stock de ${u1} insuficiente. Disponible: ${disp1}.`);
      }
      if (cantidad2Origen > 0 && disp2 < cantidad2Origen) {
        throw new BadRequestException(`Stock de ${u2} insuficiente. Disponible: ${disp2}.`);
      }

      if (!item) {
        throw new BadRequestException(
          `No hay stock registrado para esta empresa y producto en el depósito seleccionado.`,
        );
      }

      // updateMany admite solo increment o decrement por campo (no ambos a la vez).
      const net1 = cantidad1Destino - cantidad1Origen;
      const net2 = cantidad2Destino - cantidad2Origen;
      const stockData: Prisma.StockItemUpdateManyMutationInput = {};
      if (net1 > 0) stockData.cantidad1 = { increment: net1 };
      else if (net1 < 0) stockData.cantidad1 = { decrement: -net1 };
      if (net2 > 0) stockData.cantidad2 = { increment: net2 };
      else if (net2 < 0) stockData.cantidad2 = { decrement: -net2 };

      const dec = await tx.stockItem.updateMany({
        where: {
          tenantId,
          productoId: dto.productoId,
          clienteId: dto.clienteId,
          depositoId: dto.depositoId,
          cantidad1: { gte: cantidad1Origen },
          cantidad2: { gte: cantidad2Origen },
        },
        data: stockData,
      });

      if (dec.count === 0) {
        throw new BadRequestException(
          `Stock insuficiente. ${u1} disponible: ${disp1}, ${u2} disponible: ${disp2}.`,
        );
      }

      const observaciones = dto.observaciones?.trim() || null;
      const baseData = {
        tenantId,
        productoId: dto.productoId,
        clienteId: dto.clienteId,
        depositoId: dto.depositoId,
        tipo: 'division' as const,
        observaciones,
        createdBy,
        fecha: fechaMov,
      };

      const movOrigen = await tx.movimientoStock.create({
        data: { ...baseData, cantidad1: -cantidad1Origen, cantidad2: -cantidad2Origen },
        include: movimientoStockRelations,
      });

      const movDestino = await tx.movimientoStock.create({
        data: { ...baseData, cantidad1: cantidad1Destino, cantidad2: cantidad2Destino, movimientoVinculadoId: movOrigen.id },
        include: movimientoStockRelations,
      });

      await tx.movimientoStock.update({
        where: { id: movOrigen.id },
        data: { movimientoVinculadoId: movDestino.id },
      });

      return { origen: { ...movOrigen, movimientoVinculadoId: movDestino.id }, destino: movDestino };
    });
  }

  listDivisiones(tenantId: string, clienteId?: string, productoId?: string, depositoId?: string) {
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        tipo: 'division',
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
        ...(depositoId ? { depositoId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: movimientoStockRelations,
    });
  }
}
