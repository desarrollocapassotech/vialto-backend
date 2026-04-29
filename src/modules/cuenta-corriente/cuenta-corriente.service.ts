import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { $Enums } from '@prisma/client';
import { CreateMovimientoCcDto } from './dto/create-movimiento-cc.dto';
import { UpdateMovimientoCcDto } from './dto/update-movimiento-cc.dto';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import { ExportarMovimientosQueryDto } from './dto/exportar-movimientos-query.dto';

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

  private normalizeImporte(importe: number) {
    if (importe <= 0) {
      throw new BadRequestException('El importe debe ser mayor a 0');
    }
    return importe;
  }

  private async calcSaldoCliente(
    tenantId: string,
    clienteId: string,
    opts?: { hasta?: Date; before?: Date },
  ) {
    const baseWhere = {
      tenantId,
      clienteId,
      ...(opts?.hasta ? { fecha: { lte: opts.hasta } } : {}),
      ...(opts?.before ? { fecha: { lt: opts.before } } : {}),
    };
    const [cargos, pagos] = await Promise.all([
      this.prisma.movimientoCuentaCorriente.aggregate({
        where: { ...baseWhere, tipo: 'cargo' },
        _sum: { importe: true },
      }),
      this.prisma.movimientoCuentaCorriente.aggregate({
        where: { ...baseWhere, tipo: 'pago' },
        _sum: { importe: true },
      }),
    ]);
    return (cargos._sum.importe ?? 0) - (pagos._sum.importe ?? 0);
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
    const importe = this.normalizeImporte(dto.importe);
    const concepto =
      dto.concepto?.trim() ||
      (dto.tipo === 'pago' ? 'Pago manual' : 'Cargo manual');
    return this.prisma.movimientoCuentaCorriente.create({
      data: {
        tenantId,
        clienteId: dto.clienteId,
        tipo: dto.tipo as $Enums.TipoMovimientoCuentaCorriente,
        origen: 'manual',
        concepto,
        importe,
        fecha: new Date(dto.fecha),
        referencia:
          dto.formaPago?.trim() ||
          dto.referencia?.trim() ||
          null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateMovimientoCcDto) {
    const current = await this.findOne(id, tenantId);
    if (current.origen === 'viaje') {
      throw new BadRequestException(
        'Los cargos automáticos de viaje no se editan manualmente',
      );
    }
    const cid = dto.clienteId ?? current.clienteId;
    await this.assertCliente(tenantId, cid);
    return this.prisma.movimientoCuentaCorriente.update({
      where: { id },
      data: {
        clienteId: dto.clienteId,
        tipo: dto.tipo as $Enums.TipoMovimientoCuentaCorriente | undefined,
        concepto: dto.concepto?.trim(),
        importe:
          dto.importe === undefined ? undefined : this.normalizeImporte(dto.importe),
        fecha: dto.fecha === undefined ? undefined : new Date(dto.fecha),
        referencia:
          dto.formaPago?.trim() ||
          dto.referencia?.trim() ||
          undefined,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const current = await this.findOne(id, tenantId);
    if (current.origen === 'viaje') {
      throw new BadRequestException(
        'Los cargos automáticos de viaje no pueden eliminarse',
      );
    }
    return this.prisma.movimientoCuentaCorriente.delete({ where: { id } });
  }

  async registrarPago(tenantId: string, dto: RegistrarPagoDto) {
    await this.assertCliente(tenantId, dto.clienteId);
    const importe = this.normalizeImporte(dto.importe);
    return this.prisma.movimientoCuentaCorriente.create({
      data: {
        tenantId,
        clienteId: dto.clienteId,
        tipo: 'pago',
        origen: 'manual',
        concepto: dto.concepto?.trim() || 'Pago manual',
        importe,
        fecha: new Date(dto.fecha),
        referencia: dto.formaPago?.trim() || dto.referencia?.trim() || null,
      },
    });
  }

  async saldoCliente(tenantId: string, clienteId: string) {
    await this.assertCliente(tenantId, clienteId);
    const saldo = await this.calcSaldoCliente(tenantId, clienteId);
    return { clienteId, saldo };
  }

  async exportarMovimientos(tenantId: string, query: ExportarMovimientosQueryDto) {
    await this.assertCliente(tenantId, query.clienteId);
    const desde = new Date(query.desde);
    const hasta = new Date(query.hasta);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    if (desde > hasta) {
      throw new BadRequestException('La fecha de inicio no puede ser mayor a la de fin');
    }

    const saldoInicial = await this.calcSaldoCliente(tenantId, query.clienteId, {
      before: desde,
    });
    const movimientos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: {
        tenantId,
        clienteId: query.clienteId,
        fecha: { gte: desde, lte: hasta },
      },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
    });

    let acumulado = saldoInicial;
    const items = movimientos.map((mov) => {
      acumulado += mov.tipo === 'cargo' ? mov.importe : -mov.importe;
      return {
        id: mov.id,
        fecha: mov.fecha,
        tipo: mov.tipo,
        origen: mov.origen,
        concepto: mov.concepto,
        referencia: mov.referencia,
        importe: mov.importe,
        saldoAcumulado: acumulado,
      };
    });

    return {
      clienteId: query.clienteId,
      periodo: { desde, hasta },
      saldoInicial,
      saldoFinal: acumulado,
      movimientos: items,
    };
  }
}
