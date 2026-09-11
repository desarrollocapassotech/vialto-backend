import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { ViajesService } from '../viajes/viajes.service';

import { CreateMovimientoCcDto } from './dto/create-movimiento-cc.dto';
import { UpdateMovimientoCcDto } from './dto/update-movimiento-cc.dto';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import { ExportarMovimientosQueryDto } from './dto/exportar-movimientos-query.dto';
import { CreateImputacionCcDto } from './dto/create-imputacion-cc.dto';

const EPS = 1e-6;

/**
 * Imputar/deshacer una imputación puede encadenar la sincronización completa con
 * Facturación (`registrarPagoDesdeCuentaCorriente` → `syncViajesEstadoTrasPago` →
 * `syncFacturacionEstadoViajes`, que recorre todos los viajes de la factura) y con
 * `Viaje.pagosTransportista` — el default de Prisma (5s) no alcanza. Mismo valor que
 * `FACTURA_INTERACTIVE_TX`/`VIAJE_INTERACTIVE_TX` en sus respectivos services.
 */
const CC_INTERACTIVE_TX = { timeout: 20_000, maxWait: 10_000 } as const;

type ContraparteInput = { clienteId?: string | null; proveedorId?: string | null };

@Injectable()
export class CuentaCorrienteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
    private readonly viajes: ViajesService,
  ) {}

  /**
   * Valida que se indique exactamente un cliente O un proveedor (nunca ambos, nunca ninguno),
   * que pertenezca al tenant, y devuelve su condición de pago para calcular vencimientos.
   */
  private async assertContraparte(tenantId: string, params: ContraparteInput) {
    const clienteId = params.clienteId ?? null;
    const proveedorId = params.proveedorId ?? null;
    if (!!clienteId === !!proveedorId) {
      throw new BadRequestException(
        'Debe indicar exactamente un cliente o un proveedor',
      );
    }
    if (clienteId) {
      const c = await this.prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
      });
      if (!c) throw new BadRequestException('Cliente inválido');
      return { contraparteId: clienteId, condicionPagoDias: c.condicionPagoDias };
    }
    const p = await this.prisma.transportista.findFirst({
      where: { id: proveedorId!, tenantId },
    });
    if (!p) throw new BadRequestException('Proveedor inválido');
    return { contraparteId: proveedorId!, condicionPagoDias: p.condicionPagoDias };
  }

  private normalizeImporte(importe: number) {
    if (importe <= 0) {
      throw new BadRequestException('El importe debe ser mayor a 0');
    }
    return importe;
  }

  private resolveFechaVencimiento(
    fecha: Date,
    condicionPagoDias: number | null,
    override?: string,
  ): Date | null {
    if (override) return new Date(override);
    if (condicionPagoDias == null) return null;
    const v = new Date(fecha);
    v.setDate(v.getDate() + condicionPagoDias);
    return v;
  }

  private async assertSinImputaciones(
    mov: { id: string; tipo: string },
    accion: string,
  ) {
    const count = await this.prisma.imputacionCuentaCorriente.count({
      where: mov.tipo === 'pago' ? { pagoId: mov.id } : { cargoId: mov.id },
    });
    if (count > 0) {
      throw new BadRequestException(
        `No se puede ${accion} un movimiento con imputaciones registradas. Elimine primero las imputaciones.`,
      );
    }
  }

  async findAll(
    tenantId: string,
    filtros: {
      clienteId?: string;
      proveedorId?: string;
      estado?: string;
      desde?: string;
      hasta?: string;
    },
  ) {
    const rows = await this.prisma.movimientoCuentaCorriente.findMany({
      where: {
        tenantId,
        ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
        ...(filtros.proveedorId ? { proveedorId: filtros.proveedorId } : {}),
        // "estado" es ambiguo a propósito: un cargo lo tiene en estadoDisponibilidad,
        // un pago en estadoImputacion — filtrar por cualquiera de los dos cubre "mostrame
        // todo lo pendiente" sin que el usuario tenga que saber cuál campo mirar.
        ...(filtros.estado
          ? { OR: [{ estadoDisponibilidad: filtros.estado }, { estadoImputacion: filtros.estado }] }
          : {}),
        ...(filtros.desde || filtros.hasta
          ? {
              fecha: {
                ...(filtros.desde ? { gte: new Date(filtros.desde) } : {}),
                ...(filtros.hasta ? { lte: new Date(filtros.hasta) } : {}),
              },
            }
          : {}),
      },
      include: {
        imputacionesComoCargo: { select: { importe: true } },
        imputacionesComoPago: { select: { importe: true } },
      },
      orderBy: { fecha: 'desc' },
      take: 500,
    });

    // "Saldo" de la línea: lo que todavía no se resolvió de ESE movimiento puntual
    // (un cargo, cuánto le falta cobrar/pagar; un pago, cuánto le falta imputar) —
    // no confundir con el saldo acumulado de la cuenta completa.
    return rows.map(({ imputacionesComoCargo, imputacionesComoPago, ...m }) => {
      const imputado =
        m.tipo === 'cargo'
          ? imputacionesComoCargo.reduce((s, i) => s + i.importe, 0)
          : imputacionesComoPago.reduce((s, i) => s + i.importe, 0);
      return { ...m, pendiente: Math.max(m.importe - imputado, 0) };
    });
  }

  /**
   * Tablero de cobranzas/pagos: cargos abiertos (pendiente/parcial) separados en
   * vencidos, próximos a vencer (dentro de `diasProximos`) y sin vencimiento
   * configurado, cada uno partido en "a cobrar" (cliente) / "a pagar" (proveedor).
   * El "pendiente" de cada cargo descuenta lo ya imputado — no es el importe bruto.
   */
  async tablero(tenantId: string, diasProximos = 15, desde?: string, hasta?: string) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + diasProximos);

    const cargosAbiertos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: {
        tenantId,
        tipo: 'cargo',
        estadoDisponibilidad: { in: ['pendiente', 'parcial'] },
        // Filtro de período del dashboard: cargos GENERADOS dentro del rango elegido
        // (mismo criterio que "facturado en el período" de Financiero) — no cambia
        // qué es "vencido" (eso siempre es respecto a hoy), solo qué cargos entran.
        ...(desde || hasta
          ? {
              fecha: {
                ...(desde ? { gte: new Date(desde) } : {}),
                ...(hasta ? { lte: new Date(hasta) } : {}),
              },
            }
          : {}),
      },
      include: {
        cliente: { select: { id: true, nombre: true } },
        proveedor: { select: { id: true, nombre: true } },
        imputacionesComoCargo: { select: { importe: true } },
      },
      orderBy: { fechaVencimiento: 'asc' },
      take: 500,
    });

    const items = cargosAbiertos.map((c) => {
      const imputado = c.imputacionesComoCargo.reduce((s, i) => s + i.importe, 0);
      const vencido = c.fechaVencimiento != null && c.fechaVencimiento < hoy;
      return {
        id: c.id,
        contraparteId: c.contraparteId,
        contraparteNombre: c.cliente?.nombre ?? c.proveedor?.nombre ?? null,
        tipoContraparte: (c.clienteId ? 'cliente' : 'proveedor') as 'cliente' | 'proveedor',
        concepto: c.concepto,
        importe: c.importe,
        pendiente: Math.max(c.importe - imputado, 0),
        moneda: c.moneda,
        fecha: c.fecha,
        fechaVencimiento: c.fechaVencimiento,
        estadoDisponibilidad: c.estadoDisponibilidad,
        numeroComprobante: c.numeroComprobante,
        referencia: c.referencia,
        vencido,
      };
    });

    const porGrupo = (rows: typeof items) => ({
      cobrar: rows.filter((i) => i.tipoContraparte === 'cliente'),
      pagar: rows.filter((i) => i.tipoContraparte === 'proveedor'),
    });

    const vencidos = items.filter((i) => i.vencido);
    const proximosVencimientos = items.filter(
      (i) => !i.vencido && i.fechaVencimiento != null && i.fechaVencimiento <= limite,
    );
    const sinVencimiento = items.filter((i) => i.fechaVencimiento == null);

    const totalesPorMoneda = (rows: typeof items) => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.moneda, (map.get(r.moneda) ?? 0) + r.pendiente);
      return Array.from(map.entries()).map(([moneda, total]) => ({ moneda, total }));
    };
    const { cobrar: todoCobrar, pagar: todoPagar } = porGrupo(items);

    return {
      vencidos: porGrupo(vencidos),
      proximosVencimientos: porGrupo(proximosVencimientos),
      sinVencimiento: porGrupo(sinVencimiento),
      totales: {
        porCobrarPendiente: totalesPorMoneda(todoCobrar),
        porPagarPendiente: totalesPorMoneda(todoPagar),
      },
    };
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.movimientoCuentaCorriente.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    return row;
  }

  async create(tenantId: string, dto: CreateMovimientoCcDto) {
    const { contraparteId, condicionPagoDias } = await this.assertContraparte(
      tenantId,
      dto,
    );
    const importe = this.normalizeImporte(dto.importe);
    const concepto =
      dto.concepto?.trim() ||
      (dto.tipo === 'pago' ? 'Pago manual' : 'Cargo manual');
    const fecha = new Date(dto.fecha);
    return this.prisma.movimientoCuentaCorriente.create({
      data: {
        tenantId,
        clienteId: dto.clienteId ?? null,
        proveedorId: dto.proveedorId ?? null,
        contraparteId,
        tipo: dto.tipo,
        origen: 'manual',
        concepto,
        importe,
        moneda: dto.moneda?.trim() || 'ARS',
        fecha,
        fechaVencimiento:
          dto.tipo === 'cargo'
            ? this.resolveFechaVencimiento(fecha, condicionPagoDias, dto.fechaVencimiento)
            : null,
        numeroComprobante: dto.numeroComprobante?.trim() || null,
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
    await this.assertSinImputaciones(current, 'editar');

    const cambiaContraparte = dto.clienteId !== undefined || dto.proveedorId !== undefined;
    let clienteId = current.clienteId;
    let proveedorId = current.proveedorId;
    let contraparteId = current.contraparteId;
    let condicionPagoDias: number | null = null;

    if (cambiaContraparte) {
      const resolved = await this.assertContraparte(tenantId, {
        clienteId: dto.clienteId ?? null,
        proveedorId: dto.proveedorId ?? null,
      });
      clienteId = dto.clienteId ?? null;
      proveedorId = dto.proveedorId ?? null;
      contraparteId = resolved.contraparteId;
      condicionPagoDias = resolved.condicionPagoDias;
    }

    const tipo = dto.tipo ?? current.tipo;
    const fecha = dto.fecha !== undefined ? new Date(dto.fecha) : current.fecha;

    return this.prisma.movimientoCuentaCorriente.update({
      where: { id },
      data: {
        clienteId,
        proveedorId,
        contraparteId,
        tipo,
        concepto: dto.concepto?.trim(),
        importe:
          dto.importe === undefined ? undefined : this.normalizeImporte(dto.importe),
        moneda: dto.moneda?.trim() || undefined,
        fecha: dto.fecha === undefined ? undefined : fecha,
        fechaVencimiento:
          dto.fechaVencimiento !== undefined
            ? dto.fechaVencimiento
              ? new Date(dto.fechaVencimiento)
              : null
            : cambiaContraparte && tipo === 'cargo'
              ? this.resolveFechaVencimiento(fecha, condicionPagoDias)
              : undefined,
        numeroComprobante: dto.numeroComprobante?.trim() || undefined,
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
    await this.assertSinImputaciones(current, 'eliminar');
    return this.prisma.movimientoCuentaCorriente.delete({ where: { id } });
  }

  async registrarPago(tenantId: string, dto: RegistrarPagoDto) {
    const { contraparteId } = await this.assertContraparte(tenantId, dto);
    const importe = this.normalizeImporte(dto.importe);
    return this.prisma.movimientoCuentaCorriente.create({
      data: {
        tenantId,
        clienteId: dto.clienteId ?? null,
        proveedorId: dto.proveedorId ?? null,
        contraparteId,
        tipo: 'pago',
        origen: 'manual',
        concepto: dto.concepto?.trim() || 'Pago manual',
        importe,
        moneda: dto.moneda?.trim() || 'ARS',
        fecha: new Date(dto.fecha),
        referencia: dto.formaPago?.trim() || dto.referencia?.trim() || null,
      },
    });
  }

  /** Saldo de una contraparte, agrupado por moneda (hoy siempre ARS, preparado para multi-moneda). */
  private async saldoContraparte(tenantId: string, contraparteId: string) {
    const grouped = await this.prisma.movimientoCuentaCorriente.groupBy({
      by: ['moneda', 'tipo'],
      // Un cargo anulado (viaje reabierto/cancelado, factura anulada — ver Fase 3)
      // no debe seguir afectando el saldo, aunque la fila se conserve para auditoría.
      where: { tenantId, contraparteId, estadoDisponibilidad: { not: 'anulado' } },
      _sum: { importe: true },
    });
    const porMoneda = new Map<string, { cargos: number; pagos: number }>();
    for (const row of grouped) {
      const entry = porMoneda.get(row.moneda) ?? { cargos: 0, pagos: 0 };
      if (row.tipo === 'cargo') entry.cargos = row._sum.importe ?? 0;
      else entry.pagos = row._sum.importe ?? 0;
      porMoneda.set(row.moneda, entry);
    }
    return Array.from(porMoneda.entries()).map(([moneda, v]) => ({
      moneda,
      saldo: v.cargos - v.pagos,
    }));
  }

  async saldoCliente(tenantId: string, clienteId: string) {
    await this.assertContraparte(tenantId, { clienteId });
    return { clienteId, saldos: await this.saldoContraparte(tenantId, clienteId) };
  }

  async saldoProveedor(tenantId: string, proveedorId: string) {
    await this.assertContraparte(tenantId, { proveedorId });
    return {
      proveedorId,
      saldos: await this.saldoContraparte(tenantId, proveedorId),
    };
  }

  /** Suma de cargos - pagos (sin distinguir moneda), usado solo por exportarMovimientos para el running total. */
  private async calcSaldoAcumulado(
    tenantId: string,
    contraparteId: string,
    opts?: { hasta?: Date; before?: Date },
  ) {
    const baseWhere = {
      tenantId,
      contraparteId,
      estadoDisponibilidad: { not: 'anulado' },
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

  async exportarMovimientos(tenantId: string, query: ExportarMovimientosQueryDto) {
    const { contraparteId } = await this.assertContraparte(tenantId, query);
    const desde = new Date(query.desde);
    const hasta = new Date(query.hasta);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    if (desde > hasta) {
      throw new BadRequestException('La fecha de inicio no puede ser mayor a la de fin');
    }

    const saldoInicial = await this.calcSaldoAcumulado(tenantId, contraparteId, {
      before: desde,
    });
    const movimientos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: {
        tenantId,
        contraparteId,
        fecha: { gte: desde, lte: hasta },
      },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
    });

    let acumulado = saldoInicial;
    const items = movimientos.map((mov) => {
      // Un cargo anulado se sigue listando (auditoría) pero no suma al saldo.
      if (mov.estadoDisponibilidad !== 'anulado') {
        acumulado += mov.tipo === 'cargo' ? mov.importe : -mov.importe;
      }
      return {
        id: mov.id,
        fecha: mov.fecha,
        tipo: mov.tipo,
        origen: mov.origen,
        concepto: mov.concepto,
        referencia: mov.referencia,
        numeroComprobante: mov.numeroComprobante,
        moneda: mov.moneda,
        importe: mov.importe,
        estadoDisponibilidad: mov.estadoDisponibilidad,
        estadoImputacion: mov.estadoImputacion,
        saldoAcumulado: acumulado,
      };
    });

    return {
      clienteId: query.clienteId ?? null,
      proveedorId: query.proveedorId ?? null,
      periodo: { desde, hasta },
      saldoInicial,
      saldoFinal: acumulado,
      movimientos: items,
    };
  }

  // ── Imputación de pagos a cargos puntuales ──────────────────────────────

  private async sumaImputaciones(campo: 'pagoId' | 'cargoId', id: string) {
    const agg = await this.prisma.imputacionCuentaCorriente.aggregate({
      where: { [campo]: id },
      _sum: { importe: true },
    });
    return agg._sum.importe ?? 0;
  }

  private estadoImputacionDesde(imputado: number, importe: number): string {
    if (imputado <= EPS) return 'no_imputado';
    if (imputado + EPS >= importe) return 'imputado';
    return 'imputado_parcial';
  }

  private estadoDisponibilidadDesde(imputado: number, importe: number): string {
    if (imputado <= EPS) return 'pendiente';
    if (imputado + EPS >= importe) return 'cancelado';
    return 'parcial';
  }

  private async recalcularEstados(
    tx: Prisma.TransactionClient,
    pagoId: string,
    cargoId: string,
  ) {
    const [pago, cargo] = await Promise.all([
      tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: pagoId } }),
      tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: cargoId } }),
    ]);
    const [sumaPago, sumaCargo] = await Promise.all([
      tx.imputacionCuentaCorriente.aggregate({
        where: { pagoId },
        _sum: { importe: true },
      }),
      tx.imputacionCuentaCorriente.aggregate({
        where: { cargoId },
        _sum: { importe: true },
      }),
    ]);
    const imputadoPago = sumaPago._sum.importe ?? 0;
    const imputadoCargo = sumaCargo._sum.importe ?? 0;

    await tx.movimientoCuentaCorriente.update({
      where: { id: pagoId },
      data: { estadoImputacion: this.estadoImputacionDesde(imputadoPago, pago.importe) },
    });
    await tx.movimientoCuentaCorriente.update({
      where: { id: cargoId },
      data: {
        estadoDisponibilidad: this.estadoDisponibilidadDesde(imputadoCargo, cargo.importe),
      },
    });
  }

  async crearImputacion(tenantId: string, dto: CreateImputacionCcDto) {
    const importe = this.normalizeImporte(dto.importe);
    const [pago, cargo] = await Promise.all([
      this.prisma.movimientoCuentaCorriente.findFirst({
        where: { id: dto.pagoId, tenantId },
      }),
      this.prisma.movimientoCuentaCorriente.findFirst({
        where: { id: dto.cargoId, tenantId },
      }),
    ]);
    if (!pago) throw new NotFoundException('Pago no encontrado');
    if (!cargo) throw new NotFoundException('Cargo no encontrado');
    if (pago.tipo !== 'pago') {
      throw new BadRequestException('El movimiento de pago debe ser de tipo "pago"');
    }
    if (cargo.tipo !== 'cargo') {
      throw new BadRequestException('El movimiento de cargo debe ser de tipo "cargo"');
    }
    if (pago.contraparteId !== cargo.contraparteId) {
      throw new BadRequestException('El pago y el cargo deben ser de la misma contraparte');
    }
    if (pago.moneda !== cargo.moneda) {
      throw new BadRequestException('El pago y el cargo deben estar en la misma moneda');
    }

    const [imputadoDelPago, imputadoDelCargo] = await Promise.all([
      this.sumaImputaciones('pagoId', pago.id),
      this.sumaImputaciones('cargoId', cargo.id),
    ]);

    if (imputadoDelPago + importe > pago.importe + EPS) {
      throw new BadRequestException('El importe supera el saldo disponible del pago');
    }
    if (imputadoDelCargo + importe > cargo.importe + EPS) {
      throw new BadRequestException('El importe supera el saldo pendiente del cargo');
    }

    return this.prisma.$transaction(async (tx) => {
      const creada = await tx.imputacionCuentaCorriente.create({
        data: { tenantId, pagoId: pago.id, cargoId: cargo.id, importe },
      });
      await this.recalcularEstados(tx, pago.id, cargo.id);

      // Unificación con Facturación: si el cargo imputado viene de una factura real
      // (tenant con Facturación), este pago también queda reflejado allá — misma
      // lógica que "marcar como cobrada", ver FacturacionService. Los tenants sin
      // Facturación nunca tienen cargos con facturaId, así que esto nunca corre
      // para ellos (Riedel incluido).
      if (cargo.facturaId) {
        const pagoFacturacion = await this.facturacion.registrarPagoDesdeCuentaCorriente(
          tenantId,
          cargo.facturaId,
          importe,
          pago.fecha,
          pago.referencia,
          tx,
        );
        if (pagoFacturacion) {
          await tx.imputacionCuentaCorriente.update({
            where: { id: creada.id },
            data: { pagoFacturacionId: pagoFacturacion.id },
          });
        }
      }

      // Espejo simétrico del lado proveedor: si el cargo es de un fletero y viene de
      // un viaje (Flujo C), el pago también se refleja en `Viaje.pagosTransportista`
      // — misma unificación que arriba, ver ViajesService.
      if (cargo.proveedorId && cargo.viajeId) {
        await this.viajes.registrarPagoTransportistaDesdeCuentaCorriente(
          tenantId,
          cargo.viajeId,
          creada.id,
          importe,
          cargo.moneda,
          pago.fecha,
          pago.referencia,
          tx,
        );
      }

      return creada;
    }, CC_INTERACTIVE_TX);
  }

  async eliminarImputacion(id: string, tenantId: string) {
    const imputacion = await this.prisma.imputacionCuentaCorriente.findFirst({
      where: { id, tenantId },
    });
    if (!imputacion) throw new NotFoundException('Imputación no encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.imputacionCuentaCorriente.delete({ where: { id } });
      await this.recalcularEstados(tx, imputacion.pagoId, imputacion.cargoId);
      // Va al final a propósito: si el cargo tiene facturaId, esta sync recalcula
      // estadoDisponibilidad desde TODOS los pagos de la factura (no solo los de
      // CC) y debe tener la última palabra sobre `recalcularEstados`, que solo ve
      // imputaciones de Cuenta Corriente — ver nota en
      // FacturacionService.syncViajesEstadoTrasPago.
      if (imputacion.pagoFacturacionId) {
        await this.facturacion.eliminarPagoDesdeCuentaCorriente(
          tenantId,
          imputacion.pagoFacturacionId,
          tx,
        );
      }
      const cargo = await tx.movimientoCuentaCorriente.findUnique({
        where: { id: imputacion.cargoId },
      });
      if (cargo?.proveedorId && cargo.viajeId) {
        await this.viajes.eliminarPagoTransportistaDesdeCuentaCorriente(
          tenantId,
          cargo.viajeId,
          imputacion.id,
          tx,
        );
      }
    }, CC_INTERACTIVE_TX);
    return { id };
  }
}
