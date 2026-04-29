import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { $Enums } from '@prisma/client';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { CreateMovimientoStockDto } from './dto/create-movimiento-stock.dto';
import { UpdateMovimientoStockDto } from './dto/update-movimiento-stock.dto';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  listProductos(tenantId: string) {
    return this.prisma.producto.findMany({
      where: { tenantId },
      orderBy: { nombre: 'asc' },
    });
  }

  async findProducto(id: string, tenantId: string) {
    const row = await this.prisma.producto.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Producto no encontrado');
    return row;
  }

  createProducto(tenantId: string, dto: CreateProductoDto) {
    return this.prisma.producto.create({
      data: {
        tenantId,
        nombre: dto.nombre,
        unidad: dto.unidad as $Enums.UnidadProducto,
      },
    });
  }

  async updateProducto(id: string, tenantId: string, dto: UpdateProductoDto) {
    await this.findProducto(id, tenantId);
    return this.prisma.producto.update({ where: { id }, data: dto as any });
  }

  async removeProducto(id: string, tenantId: string) {
    await this.findProducto(id, tenantId);
    return this.prisma.producto.delete({ where: { id } });
  }

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
        tipo: dto.tipo as $Enums.TipoMovimientoStock,
        cantidad: dto.cantidad,
        pesoKg: dto.pesoKg ?? null,
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
}
