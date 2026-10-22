import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type MovimientoCuentaCorriente } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { ViajesService } from '../viajes/viajes.service';

import { CreateMovimientoCcDto } from './dto/create-movimiento-cc.dto';
import { UpdateMovimientoCcDto } from './dto/update-movimiento-cc.dto';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import { ExportarMovimientosQueryDto } from './dto/exportar-movimientos-query.dto';
import { CreateImputacionCcDto } from './dto/create-imputacion-cc.dto';
import { CreateImputacionMultipleCcDto } from './dto/create-imputacion-multiple-cc.dto';
import { repartirImputacion } from './imputacion-reparto.util';
import { sincronizarCargoLiquidacionCc } from '../liquidaciones-arca/liquidacion-cuenta-corriente';
import {
  cuentaEnHistorialCc,
  signoHistorialCc,
} from '../../shared/cuenta-corriente/movimiento-cc.util';
import { fechaCalendarioAr } from '../../shared/util/fecha-ar.util';
import {
  importeTotalConIvaPorTramo,
  ivaMontoDeTramos,
  roundMoney2,
} from '../../shared/util/factura-estado-lectura';

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

  /**
   * IVA de una venta/compra manual: el movimiento se registra por el total (neto + IVA)
   * y se guarda el detalle para consulta. Cobros/pagos no llevan IVA. null = sin IVA.
   */
  private calcularIva(tipo: string, neto: number, ivaPct?: number | null) {
    if (ivaPct == null || ivaPct <= 0) return null;
    if (tipo !== 'cargo') {
      throw new BadRequestException('Los cobros y pagos no llevan IVA');
    }
    // Misma cuenta que el IVA de cabecera de una factura (redondeo a 2 decimales).
    const base = roundMoney2(neto);
    return {
      pct: ivaPct,
      monto: ivaMontoDeTramos(base, [], ivaPct),
      total: importeTotalConIvaPorTramo(base, [], ivaPct),
    };
  }

  /**
   * Venta/compra manual cargada por líneas, como una factura: cada línea con su importe
   * neto y su IVA. Misma cuenta que el pie de Facturas (`computeFacturaTotalesFromBases`
   * del front): base agrupada por alícuota y el IVA redondeado por alícuota.
   */
  private calcularLineas(tipo: string, lineas: { descripcion: string; importe: number; ivaPct: number }[]) {
    if (tipo !== 'cargo') {
      throw new BadRequestException('Los cobros y pagos no llevan líneas');
    }
    if (lineas.length === 0) {
      throw new BadRequestException('Agregá al menos una línea con importe');
    }
    const normalizadas = lineas.map((l) => {
      const descripcion = l.descripcion?.trim() ?? '';
      if (!descripcion) {
        throw new BadRequestException('Todas las líneas necesitan una descripción');
      }
      return {
        descripcion,
        importe: roundMoney2(this.normalizeImporte(l.importe)),
        ivaPct: l.ivaPct,
      };
    });
    const basePorPct = new Map<number, number>();
    for (const l of normalizadas) {
      basePorPct.set(l.ivaPct, roundMoney2((basePorPct.get(l.ivaPct) ?? 0) + l.importe));
    }
    let neto = 0;
    let ivaMonto = 0;
    for (const [pct, base] of basePorPct) {
      neto = roundMoney2(neto + base);
      ivaMonto = roundMoney2(ivaMonto + roundMoney2((base * pct) / 100));
    }
    const pcts = [...basePorPct.keys()];
    return {
      lineas: normalizadas,
      neto,
      // Con alícuotas distintas no hay un único %: el detalle queda en `lineas`.
      ivaPct: pcts.length === 1 ? pcts[0] : null,
      ivaMonto,
      total: roundMoney2(neto + ivaMonto),
    };
  }

  /**
   * Concepto de los movimientos manuales (el front lo muestra como "Tipo"): siempre
   * automático, en lenguaje comercial (venta/cobro del lado cliente, compra/pago del
   * lado proveedor) en vez de la jerga contable "cargo"/"cobranza".
   */
  private defaultConcepto(tipo: string, esCliente: boolean): string {
    if (esCliente) return tipo === 'pago' ? 'COBRO' : 'VENTA';
    return tipo === 'pago' ? 'PAGO' : 'COMPRA';
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
    const facturasConArca = await this.tieneEmisionFacturasArca(tenantId);
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
        imputacionesComoPago: { select: { importe: true, cargoId: true } },
        // VTO-431: vínculo entre el movimiento anulado y su crédito de anulación, para mostrarlos juntos.
        anuladoPor: { select: { id: true, fecha: true } },
        anulaMovimiento: { select: { id: true, fecha: true, concepto: true } },
        // Clips de la columna Comprobante (mismo criterio que las grillas de Facturas y
        // Liquidaciones): adjunto o PDF de ARCA, y el de su anulación.
        factura: {
          select: {
            cae: true,
            comprobanteUrl: true,
            arcaEstado: true,
            anulacionCae: true,
            notaCreditoUrl: true,
          },
        },
        liquidacion: {
          select: {
            cbteNro: true,
            comprobanteUrl: true,
            estado: true,
            anulacionMetodo: true,
            anulacionCae: true,
            anulacionManualComprobanteUrl: true,
          },
        },
      },
      // Orden de carga (último cargado primero), no por `fecha`: un cobro con fecha
      // anterior a otros movimientos tiene que aparecer arriba al registrarlo.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });

    // "Saldo" de la línea: lo que todavía no se resolvió de ESE movimiento puntual
    // (un cargo, cuánto le falta cobrar/pagar; un pago, cuánto le falta imputar) —
    // no confundir con el saldo acumulado de la cuenta completa.
    return rows.map(({ imputacionesComoCargo, imputacionesComoPago, factura, liquidacion, ...m }) => {
      const imputado =
        m.tipo === 'cargo'
          ? imputacionesComoCargo.reduce((s, i) => s + i.importe, 0)
          : imputacionesComoPago.reduce((s, i) => s + i.importe, 0);
      // Un cargo anulado ya no tiene nada pendiente, y un crédito de anulación ya está
      // aplicado a su original.
      const anulado =
        m.tipo === 'credito' || (m.tipo === 'cargo' && m.estadoDisponibilidad === 'anulado');
      return {
        ...m,
        pendiente: anulado ? 0 : Math.max(m.importe - imputado, 0),
        // Cargos a los que está imputado un cobro/pago (para mostrar su comprobante y
        // abrir la factura/liquidación cobrada cuando es uno solo).
        cargosImputadosIds: [...new Set(imputacionesComoPago.map((i) => i.cargoId))],
        // Cuánto de este cobro/pago se aplicó a cada cargo (detalle "Ver imputaciones").
        imputacionesPorCargo: Object.entries(
          imputacionesComoPago.reduce<Record<string, number>>((acc, i) => {
            acc[i.cargoId] = (acc[i.cargoId] ?? 0) + i.importe;
            return acc;
          }, {}),
        ).map(([cargoId, importe]) => ({ cargoId, importe: roundMoney2(importe) })),
        comprobanteEditable: this.comprobanteEditable(m, liquidacion?.cbteNro ?? null, facturasConArca),
        vencimientoEditable: this.vencimientoEditable(m),
        facturaComprobantes: factura,
        liquidacionComprobantes: liquidacion,
      };
    });
  }

  /** Con ARCA el número de una factura lo asigna AFIP al emitir (mismo criterio que Facturas). */
  private async tieneEmisionFacturasArca(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    return (tenant?.modules ?? []).some((m) => m.toLowerCase() === 'emision-facturas-arca');
  }

  /**
   * ¿Se puede cargar/corregir el vencimiento desde Cuenta corriente? En una venta de
   * factura (se guarda en la factura, igual que editándola desde Facturas), en una compra
   * de liquidación (con o sin ARCA: el número del CVLP no se toca, pero cuándo se le paga
   * al proveedor sí) o en una venta/compra manual.
   */
  private vencimientoEditable(m: { tipo: string; origen: string; estadoDisponibilidad: string }) {
    if (m.tipo !== 'cargo' || m.estadoDisponibilidad === 'anulado') return false;
    return ['manual', 'factura', 'liquidacion'].includes(m.origen);
  }

  /**
   * ¿Se puede cargar/corregir el N° de comprobante desde Cuenta corriente? En una venta de
   * factura sin ARCA (con ARCA lo asigna AFIP), en una compra de liquidación sin CVLP (el
   * número es el de la factura del proveedor), en una venta/compra manual o en un
   * cobro/pago manual (su recibo / orden de pago, para completar los cargados sin número).
   */
  private comprobanteEditable(
    m: {
      tipo: string;
      origen: string;
      estadoDisponibilidad: string;
      liquidacionId: string | null;
      facturaId: string | null;
    },
    cbteNroLiquidacion: number | null,
    facturasConArca: boolean,
  ): boolean {
    if (m.estadoDisponibilidad === 'anulado') return false;
    if (m.tipo === 'pago') return m.origen === 'manual';
    if (m.tipo !== 'cargo') return false;
    if (m.origen === 'manual') return true;
    if (m.origen === 'factura') return !!m.facturaId && !facturasConArca;
    return m.origen === 'liquidacion' && !!m.liquidacionId && cbteNroLiquidacion == null;
  }

  /**
   * Carga o corrige el N° de comprobante y/o el vencimiento desde Cuenta corriente (cada
   * uno solo si viene en el dto). El dato vive en el comprobante de origen y el movimiento
   * se refresca desde ahí, así nunca quedan dos valores distintos:
   * - factura: número y vencimiento se guardan en la factura (`updateFactura`, el mismo
   *   camino que editarla desde Facturas, que valida el número único y resincroniza el cargo);
   * - liquidación: el número va a `numeroComprobanteProveedor` (el mismo campo que se edita
   *   desde Liquidaciones); el vencimiento se guarda en el movimiento (la liquidación no
   *   tiene uno propio y el sync no lo pisa);
   * - venta/compra manual: todo en el movimiento.
   */
  async actualizarComprobante(
    tenantId: string,
    id: string,
    dto: {
      numeroComprobante?: string | null;
      fechaVencimiento?: string | null;
      comprobanteUrl?: string | null;
    },
  ) {
    const mov = await this.findOne(id, tenantId);
    const liquidacion = mov.liquidacionId
      ? await this.prisma.liquidacion.findFirst({
          where: { id: mov.liquidacionId, tenantId },
          select: { id: true, cbteNro: true },
        })
      : null;
    const facturasConArca =
      mov.origen === 'factura' ? await this.tieneEmisionFacturasArca(tenantId) : false;

    if (
      dto.numeroComprobante !== undefined &&
      !this.comprobanteEditable(mov, liquidacion?.cbteNro ?? null, facturasConArca)
    ) {
      throw new BadRequestException(
        mov.origen === 'liquidacion'
          ? 'La liquidación se emitió con ARCA: su número es el del comprobante de AFIP.'
          : mov.origen === 'factura'
            ? 'El número de la factura lo asigna ARCA al emitirla.'
            : 'El comprobante de este movimiento no se puede editar.',
      );
    }
    if (dto.fechaVencimiento !== undefined && !this.vencimientoEditable(mov)) {
      throw new BadRequestException('El vencimiento de este movimiento no se puede editar.');
    }
    // El archivo vive en la factura/liquidación: una venta/compra manual no tiene dónde guardarlo.
    if (
      dto.comprobanteUrl !== undefined &&
      (mov.origen === 'manual' ||
        !this.comprobanteEditable(mov, liquidacion?.cbteNro ?? null, facturasConArca))
    ) {
      throw new BadRequestException('A este movimiento no se le puede adjuntar el comprobante.');
    }
    const comprobanteUrl =
      dto.comprobanteUrl !== undefined ? dto.comprobanteUrl?.trim() || null : undefined;

    if (mov.origen === 'factura' && mov.facturaId) {
      const numero = dto.numeroComprobante?.trim();
      if (dto.numeroComprobante !== undefined && !numero) {
        // Sin ARCA el número de la factura es obligatorio (mismo criterio que Facturas).
        throw new BadRequestException('Ingresá el número de la factura.');
      }
      await this.facturacion.updateFactura(mov.facturaId, tenantId, {
        ...(numero ? { numero } : {}),
        ...(dto.fechaVencimiento !== undefined
          ? { fechaVencimiento: dto.fechaVencimiento ?? '' }
          : {}),
        // updateFactura toma '' como "quitar el adjunto".
        ...(comprobanteUrl !== undefined ? { comprobanteUrl: comprobanteUrl ?? '' } : {}),
      });
      return this.findOne(id, tenantId);
    }

    if (dto.fechaVencimiento !== undefined) {
      await this.prisma.movimientoCuentaCorriente.update({
        where: { id: mov.id },
        data: {
          fechaVencimiento: dto.fechaVencimiento ? fechaCalendarioAr(dto.fechaVencimiento) : null,
        },
      });
    }
    if (dto.numeroComprobante !== undefined) {
      const valor = dto.numeroComprobante?.trim() || null;
      if (!valor && mov.origen === 'manual') {
        throw new BadRequestException('Ingresá el número de comprobante');
      }
      if (liquidacion) {
        await this.prisma.liquidacion.update({
          where: { id: liquidacion.id },
          data: { numeroComprobanteProveedor: valor, updatedAt: new Date() },
        });
        await sincronizarCargoLiquidacionCc(this.prisma, tenantId, liquidacion.id);
      } else {
        await this.prisma.movimientoCuentaCorriente.update({
          where: { id: mov.id },
          data: { numeroComprobante: valor },
        });
      }
    }
    if (comprobanteUrl !== undefined && liquidacion) {
      await this.prisma.liquidacion.update({
        where: { id: liquidacion.id },
        data: { comprobanteUrl, updatedAt: new Date() },
      });
    }
    return this.findOne(id, tenantId);
  }

  /**
   * Tablero de cobranzas/pagos: cargos abiertos (pendiente/parcial) separados en
   * vencidos, próximos a vencer (dentro de `diasProximos`) y sin vencimiento
   * configurado, cada uno partido en "a cobrar" (cliente) / "a pagar" (proveedor).
   * El "pendiente" de cada cargo descuenta lo ya imputado — no es el importe bruto.
   */
  async tablero(tenantId: string, diasProximos = 15, desde?: string, hasta?: string) {
    // Hoy en Argentina a medianoche UTC, igual que `fechaVencimiento` (no la medianoche del server).
    const hoy = fechaCalendarioAr();
    const limite = new Date(hoy);
    limite.setUTCDate(limite.getUTCDate() + diasProximos);

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

  /**
   * Ventas y compras manuales solo en empresas que no tienen el módulo que las genera:
   * con Facturación (manual o ARCA) las ventas salen únicamente de las facturas, y con
   * Liquidaciones (manual o ARCA) las compras salen únicamente de las liquidaciones — así
   * el mismo flete nunca se carga dos veces. Cobros y pagos manuales siempre se permiten.
   * Espejo del front: `ventasNacenDeFacturas`/`comprasNacenDeLiquidaciones` (lib/tenantModules.ts).
   */
  private async assertCargoManualPermitido(tenantId: string, dto: CreateMovimientoCcDto) {
    if (dto.tipo !== 'cargo') return;
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    const modules = new Set((tenant?.modules ?? []).map((m) => m.toLowerCase()));
    if (dto.clienteId && (modules.has('facturacion') || modules.has('emision-facturas-arca'))) {
      throw new BadRequestException(
        'Tu empresa tiene Facturación: las ventas se registran al crear la factura.',
      );
    }
    if (
      dto.proveedorId &&
      (modules.has('liquidaciones') || modules.has('emision-liquido-producto-arca'))
    ) {
      throw new BadRequestException(
        'Tu empresa tiene Liquidaciones: las compras se registran al crear la liquidación.',
      );
    }
  }

  async create(tenantId: string, dto: CreateMovimientoCcDto, userId?: string) {
    const { contraparteId, condicionPagoDias } = await this.assertContraparte(
      tenantId,
      dto,
    );
    await this.assertCargoManualPermitido(tenantId, dto);
    // Todo movimiento manual se identifica por su comprobante (factura de la venta/compra,
    // recibo u orden de pago del cobro/pago): es lo que muestra la grilla y lo que se elige
    // al imputar.
    if (!dto.numeroComprobante?.trim()) {
      throw new BadRequestException('Ingresá el número de comprobante');
    }
    const porLineas = dto.lineas ? this.calcularLineas(dto.tipo, dto.lineas) : null;
    if (!porLineas && dto.importe == null) {
      throw new BadRequestException('Ingresá un importe');
    }
    const neto = porLineas ? porLineas.neto : this.normalizeImporte(dto.importe!);
    const iva = porLineas
      ? porLineas.ivaMonto > 0
        ? { pct: porLineas.ivaPct, monto: porLineas.ivaMonto, total: porLineas.total }
        : null
      : this.calcularIva(dto.tipo, neto, dto.ivaPct);
    // Siempre automático (VENTA/COMPRA/COBRO/PAGO): no se tipea a mano.
    const concepto = this.defaultConcepto(dto.tipo, !!dto.clienteId);
    const fecha = new Date(dto.fecha);
    const moneda = dto.moneda?.trim() || 'ARS';
    const cargosAImputar =
      dto.tipo === 'pago' && dto.imputarACargoIds?.length
        ? await this.cargosParaImputarAlRegistrar(tenantId, contraparteId, moneda, dto.imputarACargoIds)
        : [];

    // Cobro/pago y sus imputaciones juntos: o queda todo registrado o nada.
    return this.prisma.$transaction(async (tx) => {
      const creado = await tx.movimientoCuentaCorriente.create({
        data: {
        tenantId,
        clienteId: dto.clienteId ?? null,
        proveedorId: dto.proveedorId ?? null,
        contraparteId,
        tipo: dto.tipo,
        origen: 'manual',
        concepto,
        importe: iva ? iva.total : neto,
        importeNeto: iva ? roundMoney2(neto) : null,
        ivaPct: iva ? iva.pct : null,
        ivaMonto: iva ? iva.monto : null,
        lineas: porLineas ? porLineas.lineas : Prisma.DbNull,
        moneda,
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
        createdBy: userId ?? null,
      },
      });

      // Del cargo más viejo al más nuevo, cada uno hasta su saldo pendiente.
      let restante = creado.importe;
      for (const { cargo, pendiente } of cargosAImputar) {
        if (restante <= EPS) break;
        const importe = roundMoney2(Math.min(pendiente, restante));
        await this.aplicarImputacion(tx, tenantId, creado, cargo, importe, userId);
        restante = roundMoney2(restante - importe);
      }
      return tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: creado.id } });
    }, CC_INTERACTIVE_TX);
  }

  /**
   * Valida los cargos elegidos al registrar un cobro/pago y los devuelve ordenados del
   * más viejo al más nuevo, con su saldo pendiente.
   */
  private async cargosParaImputarAlRegistrar(
    tenantId: string,
    contraparteId: string,
    moneda: string,
    ids: string[],
  ) {
    const unicos = [...new Set(ids)];
    const cargos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: { id: { in: unicos }, tenantId, contraparteId, tipo: 'cargo' },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
    });
    if (cargos.length !== unicos.length) {
      throw new NotFoundException('Una de las facturas elegidas no existe o no es de esta cuenta');
    }
    const conPendiente = [];
    for (const cargo of cargos) {
      if (cargo.estadoDisponibilidad === 'anulado') {
        throw new BadRequestException('Una de las facturas elegidas está anulada');
      }
      if (cargo.moneda !== moneda) {
        throw new BadRequestException('Las facturas elegidas tienen que estar en la moneda del cobro');
      }
      const pendiente = cargo.importe - (await this.sumaImputaciones('cargoId', cargo.id));
      if (pendiente <= EPS) {
        throw new BadRequestException('Una de las facturas elegidas ya no tiene saldo pendiente');
      }
      conPendiente.push({ cargo, pendiente });
    }
    return conPendiente;
  }

  /**
   * Edita un movimiento manual. Comprobante, fechas y medio de cobro se editan siempre;
   * lo que mueve plata (importe, líneas, moneda, tipo, contraparte) solo sin imputaciones,
   * porque dejaría inconsistentes los saldos de lo ya imputado.
   */
  async update(id: string, tenantId: string, dto: UpdateMovimientoCcDto) {
    const current = await this.findOne(id, tenantId);
    this.assertEditableAMano(current, 'editar');

    const cambiaContraparte = dto.clienteId !== undefined || dto.proveedorId !== undefined;
    const cambiaMonto =
      dto.importe !== undefined ||
      dto.lineas !== undefined ||
      (dto.moneda !== undefined && dto.moneda !== current.moneda) ||
      (dto.tipo !== undefined && dto.tipo !== current.tipo) ||
      cambiaContraparte;
    if (cambiaMonto) {
      await this.assertSinImputaciones(current, 'cambiar el importe, la moneda o la cuenta de');
    }
    if (dto.numeroComprobante !== undefined && !dto.numeroComprobante.trim()) {
      throw new BadRequestException('Ingresá el número de comprobante');
    }
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
    // Venta/compra por líneas: mismo cálculo que al crearla (total = neto + IVA por alícuota).
    const porLineas = dto.lineas ? this.calcularLineas(tipo, dto.lineas) : null;
    const referencia =
      dto.formaPago !== undefined || dto.referencia !== undefined
        ? (dto.formaPago ?? dto.referencia)?.trim() || null
        : undefined;

    return this.prisma.movimientoCuentaCorriente.update({
      where: { id },
      data: {
        clienteId,
        proveedorId,
        contraparteId,
        tipo,
        concepto: dto.concepto?.trim(),
        ...(porLineas
          ? {
              importe: porLineas.total,
              importeNeto: porLineas.ivaMonto > 0 ? porLineas.neto : null,
              ivaPct: porLineas.ivaMonto > 0 ? porLineas.ivaPct : null,
              ivaMonto: porLineas.ivaMonto > 0 ? porLineas.ivaMonto : null,
              lineas: porLineas.lineas,
            }
          : {
              importe:
                dto.importe === undefined ? undefined : this.normalizeImporte(dto.importe),
              // Si cambia el importe o el tipo, el detalle de IVA de la carga original ya no aplica.
              ...(dto.importe !== undefined || tipo !== current.tipo
                ? { importeNeto: null, ivaPct: null, ivaMonto: null, lineas: Prisma.DbNull }
                : {}),
            }),
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
        referencia,
      },
    });
  }

  /**
   * Solo los movimientos cargados a mano se editan/eliminan desde acá. Los de viaje,
   * factura y liquidación los mantiene su módulo de origen, y una anulación (o un
   * movimiento ya anulado) queda como está para auditoría (VTO-431).
   */
  private assertEditableAMano(
    mov: { origen: string; estadoDisponibilidad: string },
    accion: 'editar' | 'eliminar',
  ) {
    if (mov.origen !== 'manual') {
      throw new BadRequestException(
        `Los movimientos automáticos (viaje, factura, liquidación o anulación) no se pueden ${accion} a mano`,
      );
    }
    if (mov.estadoDisponibilidad === 'anulado') {
      throw new BadRequestException(`Un movimiento anulado no se puede ${accion}`);
    }
  }

  async remove(id: string, tenantId: string) {
    const current = await this.findOne(id, tenantId);
    this.assertEditableAMano(current, 'eliminar');
    await this.assertSinImputaciones(current, 'eliminar');
    return this.prisma.movimientoCuentaCorriente.delete({ where: { id } });
  }

  async registrarPago(tenantId: string, dto: RegistrarPagoDto, userId?: string) {
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
        concepto: dto.concepto?.trim() || this.defaultConcepto('pago', !!dto.clienteId),
        importe,
        moneda: dto.moneda?.trim() || 'ARS',
        fecha: new Date(dto.fecha),
        referencia: dto.formaPago?.trim() || dto.referencia?.trim() || null,
        createdBy: userId ?? null,
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
      // Los créditos de anulación quedan `anulado` (fuera de este where) junto con su
      // original; igual se discrimina el tipo explícitamente para no confundirlos con pagos.
      if (row.tipo === 'cargo') entry.cargos = row._sum.importe ?? 0;
      else if (row.tipo === 'pago') entry.pagos = row._sum.importe ?? 0;
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

  /** Suma de cargos − pagos − créditos (sin distinguir moneda), usado solo por exportarMovimientos para el running total. */
  private async calcSaldoAcumulado(
    tenantId: string,
    contraparteId: string,
    opts?: { hasta?: Date; before?: Date },
  ) {
    // Misma regla que el historial (`cuentaEnHistorialCc`): un cargo anulado cuenta si
    // tiene su crédito de anulación (y el crédito cuenta); solo se excluye el anulado sin
    // compensación (anulaciones previas a VTO-431, movimientos unificados).
    const baseWhere: Prisma.MovimientoCuentaCorrienteWhereInput = {
      tenantId,
      contraparteId,
      OR: [
        { estadoDisponibilidad: { not: 'anulado' } },
        { anulaMovimientoId: { not: null } },
        { anuladoPor: { isNot: null } },
      ],
      ...(opts?.hasta ? { fecha: { lte: opts.hasta } } : {}),
      ...(opts?.before ? { fecha: { lt: opts.before } } : {}),
    };
    const [cargos, haber] = await Promise.all([
      this.prisma.movimientoCuentaCorriente.aggregate({
        where: { ...baseWhere, tipo: 'cargo' },
        _sum: { importe: true },
      }),
      this.prisma.movimientoCuentaCorriente.aggregate({
        where: { ...baseWhere, tipo: { in: ['pago', 'credito'] } },
        _sum: { importe: true },
      }),
    ]);
    return (cargos._sum.importe ?? 0) - (haber._sum.importe ?? 0);
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
      include: { anuladoPor: { select: { id: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    // Mismo orden que el detalle en pantalla: el saldo acumulado se recorre en orden de
    // carga y la lista sale con el último cargado primero (PDF y Excel la usan tal cual).
    let acumulado = saldoInicial;
    const items = movimientos.map((mov) => {
      // Un cargo anulado se sigue listando (auditoría); suma solo si tiene su crédito de
      // anulación, que resta como un cobro.
      if (cuentaEnHistorialCc({ ...mov, compensado: !!mov.anuladoPor })) {
        acumulado += signoHistorialCc(mov.tipo) * mov.importe;
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
      movimientos: items.reverse(),
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

  private validarParImputacion(pago: MovimientoCuentaCorriente, cargo: MovimientoCuentaCorriente) {
    if (pago.tipo !== 'pago') {
      throw new BadRequestException('El movimiento elegido como pago no es un pago');
    }
    if (cargo.tipo !== 'cargo') {
      throw new BadRequestException('El movimiento elegido no es un comprobante de compra/venta');
    }
    if (cargo.estadoDisponibilidad === 'anulado') {
      throw new BadRequestException('El comprobante está anulado: no se le pueden imputar cobros ni pagos');
    }
    if (pago.contraparteId !== cargo.contraparteId) {
      throw new BadRequestException('El pago y el comprobante deben ser de la misma contraparte');
    }
    if (pago.moneda !== cargo.moneda) {
      throw new BadRequestException('El pago y el comprobante deben estar en la misma moneda');
    }
  }

  /** Crea la imputación, recalcula estados y la refleja en Facturación / pagos del viaje. */
  private async aplicarImputacion(
    tx: Prisma.TransactionClient,
    tenantId: string,
    pago: MovimientoCuentaCorriente,
    cargo: MovimientoCuentaCorriente,
    importe: number,
    userId?: string,
  ) {
    const creada = await tx.imputacionCuentaCorriente.create({
      data: { tenantId, pagoId: pago.id, cargoId: cargo.id, importe, createdBy: userId ?? null },
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
  }

  async crearImputacion(tenantId: string, dto: CreateImputacionCcDto, userId?: string) {
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
    if (!cargo) throw new NotFoundException('Comprobante no encontrado');
    this.validarParImputacion(pago, cargo);

    const [imputadoDelPago, imputadoDelCargo] = await Promise.all([
      this.sumaImputaciones('pagoId', pago.id),
      this.sumaImputaciones('cargoId', cargo.id),
    ]);

    if (imputadoDelPago + importe > pago.importe + EPS) {
      throw new BadRequestException('El importe supera el saldo disponible del pago');
    }
    if (imputadoDelCargo + importe > cargo.importe + EPS) {
      throw new BadRequestException('El importe supera el saldo pendiente del comprobante');
    }

    return this.prisma.$transaction(
      (tx) => this.aplicarImputacion(tx, tenantId, pago, cargo, importe, userId),
      CC_INTERACTIVE_TX,
    );
  }

  /**
   * Imputa un comprobante con dos cobros/pagos en una sola operación: se consume primero
   * el de menor disponible y el otro cubre solo lo que falta (`repartirImputacion`). Todo
   * en una transacción: o se aplican ambas imputaciones o ninguna.
   */
  async crearImputacionMultiple(
    tenantId: string,
    dto: CreateImputacionMultipleCcDto,
    userId?: string,
  ) {
    if (new Set(dto.pagoIds).size !== dto.pagoIds.length) {
      throw new BadRequestException('No se puede elegir el mismo cobro dos veces');
    }
    const cargo = await this.prisma.movimientoCuentaCorriente.findFirst({
      where: { id: dto.cargoId, tenantId },
    });
    if (!cargo) throw new NotFoundException('Comprobante no encontrado');
    const pagos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: { id: { in: dto.pagoIds }, tenantId },
    });
    if (pagos.length !== dto.pagoIds.length) throw new NotFoundException('Pago no encontrado');
    for (const pago of pagos) this.validarParImputacion(pago, cargo);

    const imputadoDelCargo = await this.sumaImputaciones('cargoId', cargo.id);
    const pendienteCargo = cargo.importe - imputadoDelCargo;
    if (pendienteCargo <= EPS) {
      throw new BadRequestException('El comprobante ya no tiene saldo pendiente');
    }
    const conDisponible = await Promise.all(
      pagos.map(async (p) => ({
        pago: p,
        disponible: p.importe - (await this.sumaImputaciones('pagoId', p.id)),
      })),
    );
    if (conDisponible.some((p) => p.disponible <= EPS)) {
      throw new BadRequestException('Uno de los cobros elegidos ya no tiene saldo disponible');
    }

    const reparto = repartirImputacion(
      pendienteCargo,
      conDisponible.map(({ pago, disponible }) => ({
        id: pago.id,
        disponible,
        fecha: pago.fecha,
        createdAt: pago.createdAt,
      })),
    ).filter((r) => r.importe > EPS);

    const imputaciones = await this.prisma.$transaction(async (tx) => {
      const creadas = [];
      for (const r of reparto) {
        const pago = pagos.find((p) => p.id === r.pagoId)!;
        creadas.push(await this.aplicarImputacion(tx, tenantId, pago, cargo, r.importe, userId));
      }
      return creadas;
    }, CC_INTERACTIVE_TX);
    return { imputaciones };
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
