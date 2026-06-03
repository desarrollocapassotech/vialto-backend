import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { ClerkVialtoRoleService } from '../../core/auth/clerk-vialto-role.service';
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
  unidadMedida: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
} as const;

const movimientoStockRelations = {
  producto: { select: { id: true, nombre: true, unidadMedida: true } },
  cliente: { select: { id: true, nombre: true } },
} as const;

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clerkUsers: ClerkVialtoRoleService,
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

    const um = query.unidadMedida?.trim();
    if (um) {
      where.unidadMedida = um;
    }

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
            unidadMedida: dto.unidadMedida?.trim() || '',
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

  // ───────────────── PRESENTACIONES ────────────────────────────────────────

  async listPresentaciones(productoId: string, tenantId: string) {
    const p = await this.prisma.producto.findFirst({ where: { id: productoId, tenantId } });
    if (!p) throw new NotFoundException('Producto no encontrado');
    return this.prisma.presentacion.findMany({
      where: { productoId, tenantId },
      orderBy: { nombre: 'asc' },
    });
  }

  async createPresentacion(productoId: string, tenantId: string, dto: CreatePresentacionDto) {
    const p = await this.prisma.producto.findFirst({ where: { id: productoId, tenantId } });
    if (!p) throw new NotFoundException('Producto no encontrado');
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

  async updatePresentacion(productoId: string, id: string, tenantId: string, dto: UpdatePresentacionDto) {
    const row = await this.prisma.presentacion.findFirst({ where: { id, productoId, tenantId } });
    if (!row) throw new NotFoundException('Presentación no encontrada');
    return this.prisma.presentacion.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.cantidadEquivalente !== undefined ? { cantidadEquivalente: dto.cantidadEquivalente } : {}),
        ...(dto.unidadEquivalente !== undefined ? { unidadEquivalente: dto.unidadEquivalente.trim() } : {}),
      },
    });
  }

  async removePresentacion(productoId: string, id: string, tenantId: string) {
    const row = await this.prisma.presentacion.findFirst({ where: { id, productoId, tenantId } });
    if (!row) throw new NotFoundException('Presentación no encontrada');
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
    options?: { soloIngresoEgreso?: boolean },
  ) {
    const soloIe = options?.soloIngresoEgreso === true;
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        ...(soloIe ? { tipo: { in: ['ingreso', 'egreso'] } } : {}),
        ...(productoId ? { productoId } : {}),
        ...(clienteId ? { clienteId } : {}),
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
    await this.assertRemito(tenantId, dto.remitoId);
    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (Number.isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida');

    const cantidadPallets = dto.cantidadPallets ?? 0;
    const cantidadSuelto = dto.cantidadSuelto ?? 0;
    if (cantidadPallets <= 0 && cantidadSuelto <= 0) {
      throw new BadRequestException('Al menos uno de cantidadPallets o cantidadSuelto debe ser mayor a 0.');
    }

    return this.prisma.movimientoStock.create({
      data: {
        tenantId,
        productoId: dto.productoId,
        clienteId: dto.clienteId,
        tipo: dto.tipo,
        cantidadPallets,
        cantidadSuelto,
        remitoId: dto.remitoId ?? null,
        fecha: fechaMov,
      },
    });
  }

  async updateMovimiento(id: string, tenantId: string, dto: UpdateMovimientoStockDto) {
    const cur = await this.findMovimiento(id, tenantId);
    const pid = dto.productoId ?? cur.productoId;
    const cid = dto.clienteId ?? cur.clienteId;
    await this.assertProductoCliente(tenantId, pid, cid);
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

  // ───────────────── INGRESOS AL DEPÓSITO ───────────────────────────────────

  async createIngreso(tenantId: string, dto: CreateIngresoDto, createdBy: string) {
    const cantidadPallets = dto.cantidadPallets ?? 0;
    const cantidadSuelto = dto.cantidadSuelto ?? 0;
    if (cantidadPallets <= 0 && cantidadSuelto <= 0) {
      throw new BadRequestException('Al menos uno de cantidadPallets o cantidadSuelto debe ser mayor a 0.');
    }

    const [producto, cliente] = await Promise.all([
      this.prisma.producto.findFirst({ where: { id: dto.productoId, tenantId } }),
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
    ]);
    if (!producto) throw new BadRequestException('Producto inválido');
    if (!cliente) throw new BadRequestException('Cliente inválido');

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (Number.isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida');

    return this.prisma.$transaction(async (tx) => {
      const movimiento = await tx.movimientoStock.create({
        data: {
          tenantId,
          productoId: dto.productoId,
          clienteId: dto.clienteId,
          tipo: 'ingreso',
          cantidadPallets,
          cantidadSuelto,
          observaciones: dto.observaciones?.trim() || null,
          createdBy,
          fecha: fechaMov,
        },
        include: {
          producto: { select: { id: true, nombre: true, unidadMedida: true } },
          cliente: { select: { id: true, nombre: true } },
        },
      });

      await tx.stockItem.upsert({
        where: {
          productoId_clienteId: {
            productoId: dto.productoId,
            clienteId: dto.clienteId,
          },
        },
        update: {
          cantidadPallets: { increment: cantidadPallets },
          cantidadSuelto: { increment: cantidadSuelto },
          tenantId,
        },
        create: {
          tenantId,
          productoId: dto.productoId,
          clienteId: dto.clienteId,
          cantidadPallets,
          cantidadSuelto,
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
        cliente: { select: { id: true, nombre: true } },
      },
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
    const cantidadPallets = dto.cantidadPallets ?? 0;
    const cantidadSuelto = dto.cantidadSuelto ?? 0;
    if (cantidadPallets <= 0 && cantidadSuelto <= 0) {
      throw new BadRequestException('Al menos uno de cantidadPallets o cantidadSuelto debe ser mayor a 0.');
    }

    const [producto, cliente] = await Promise.all([
      this.prisma.producto.findFirst({ where: { id: dto.productoId, tenantId } }),
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
    ]);
    if (!producto) throw new BadRequestException('Producto inválido');
    if (!cliente) throw new BadRequestException('Cliente inválido');

    const fechaMov = parseFechaMovimientoStock(dto.fecha);
    if (Number.isNaN(fechaMov.getTime())) throw new BadRequestException('Fecha inválida');

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
          productoId_clienteId: {
            productoId: dto.productoId,
            clienteId: dto.clienteId,
          },
        },
      });

      const dispPallets = item?.cantidadPallets ?? 0;
      const dispSuelto = item?.cantidadSuelto ?? 0;

      if (cantidadPallets > 0 && dispPallets < cantidadPallets) {
        throw new BadRequestException(
          `Stock de pallets insuficiente para esta empresa y producto. Disponible: ${dispPallets}.`,
        );
      }
      if (cantidadSuelto > 0 && dispSuelto < cantidadSuelto) {
        throw new BadRequestException(
          `Stock suelto insuficiente para esta empresa y producto. Disponible: ${dispSuelto}.`,
        );
      }

      // Validación atómica con optimistic locking vía condición en updateMany
      const dec = await tx.stockItem.updateMany({
        where: {
          tenantId,
          productoId: dto.productoId,
          clienteId: dto.clienteId,
          cantidadPallets: { gte: cantidadPallets },
          cantidadSuelto: { gte: cantidadSuelto },
        },
        data: {
          cantidadPallets: { decrement: cantidadPallets },
          cantidadSuelto: { decrement: cantidadSuelto },
        },
      });
      if (dec.count === 0) {
        throw new BadRequestException(
          `Stock insuficiente para esta empresa y producto. Pallets disponibles: ${dispPallets}, suelto disponible: ${dispSuelto}.`,
        );
      }

      const remitoUrl = dto.remitoEscaneadoUrl?.trim() || null;

      const seq = await this.nextSecuenciaRemitoTx(tx, tenantId, year);
      let numeroRemito = this.formatoNumeroRemito(prefix, year, seq, digitos);

      const tryCreate = async (numero: string) =>
        tx.movimientoStock.create({
          data: {
            tenantId,
            productoId: dto.productoId,
            clienteId: dto.clienteId,
            tipo: 'egreso',
            cantidadPallets,
            cantidadSuelto,
            numeroRemito: numero,
            observaciones: dto.observaciones?.trim() || null,
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

  listEgresos(tenantId: string, clienteId?: string, productoId?: string) {
    return this.prisma.movimientoStock.findMany({
      where: {
        tenantId,
        tipo: 'egreso',
        ...(clienteId ? { clienteId } : {}),
        ...(productoId ? { productoId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: movimientoStockRelations,
    });
  }
}
