import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  resolveDashboardPeriod,
  type DashboardPeriodKind,
  type ResolvedDashboardPeriod,
} from './dashboard-period';
import {
  DASHBOARD_SIN_FACTURAR_TZ,
  sinFacturarArHalfOpenRanges,
  type SinFacturarArHalfOpen,
} from './dashboard-sin-facturar-ar-range';
import { VIAJE_ESTADOS_COMPLETADOS_TABLERO } from '../viajes/viaje-estados';
import {
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from '../../shared/util/factura-estado-lectura';
import {
  buildGananciaBrutaResumen,
  UMBRAL_MARGEN_BAJO_PCT,
} from '../viajes/viaje-ganancia-bruta.util';

export type MetricCompare = {
  current: number;
  previous: number;
  changePct: number | null;
  sentiment: 'positive' | 'negative' | 'neutral';
  /** Desglose por moneda del período actual (sin conversión entre monedas). */
  currencies?: { ARS: number; USD: number };
};

export type OwnerDashboardResponse = {
  period: {
    kind: DashboardPeriodKind;
    start: string;
    end: string;
    prevStart: string;
    prevEnd: string;
  };
  financiero?: {
    /** Monto sin facturar atribuible al período (finalizados en ventana + pendiente/en curso por fecha de carga o alta). */
    sinFacturarPeriodo: MetricCompare;
    /** Suma de montos de viajes en estado facturado sin cobrar (pipeline actual, por moneda). */
    facturado: MetricCompare;
    cobrado: MetricCompare;
    aPagarTransportistas: MetricCompare;
    margen: MetricCompare;
    mostrarDiferenciaNeta: boolean;
    diferenciaNetaEstimada: number;
    diferenciaNetaCompare: MetricCompare;
  };
  alertas?: {
    facturasVencidas: {
      cantidad: number;
      montoTotal: number;
      montosPorMoneda: { ARS: number; USD: number };
      items: Array<{ id: string; numero: string }>;
    };
    viajesSinFactura: {
      cantidad: number;
      montoTotal: number;
      montosPorMoneda: { ARS: number; USD: number };
      items: Array<{
        id: string;
        numero: string;
        clienteNombre: string;
        fecha: string | null;
        origen: string | null;
        destino: string | null;
      }>;
    };
    /** Cargas de combustible marcadas `sospechoso` (snapshot actual, no filtrado por período). */
    cargasSospechosas?: {
      cantidad: number;
      montoTotal: number;
    };
    /**
     * Viajes del período con margen bajo o negativo (ver `viaje-ganancia-bruta.util`).
     * `montoTotal` solo suma el margen negativo en ARS — el detalle completo (incl. USD)
     * vive en GET /dashboard/financiero.
     */
    margenBajo?: {
      cantidad: number;
      montoTotal: number;
    };
  } | null;
  viajes?: {
    enCurso: MetricCompare;
    completados: MetricCompare;
    /** Suma de montos (snapshot actual, no filtrado por el período del selector). */
    sinFacturarMonto: number;
    /** Conteos de pipeline: sin facturar / sin cobrar (snapshot); cobrados (período + cobros registrados). */
    sinFacturar: number;
    sinCobrar: number;
    cobrados: number;
  };
  stock?: {
    totalProductos: number;
    totalClientes: number;
    ingresosHoy: number;
    egresosHoy: number;
  };
};

type CompareMode = 'higher_better' | 'lower_better';

/** Viajes con factura emitida, pendientes de cobro (incluye alias legados en BD). */
const ESTADOS_VIAJE_FACTURADO = ['facturado_sin_cobrar', 'finalizado_facturado'] as const;

/** Viajes cobrados (incluye alias legados en BD). */
const ESTADOS_VIAJE_COBRADO = ['cobrado', 'finalizado_cobrado'] as const;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function withCurrencies(
  m: MetricCompare,
  currencies?: { ARS: number; USD: number },
): MetricCompare {
  if (!currencies) return m;
  return {
    ...m,
    currencies: {
      ARS: roundMoney(currencies.ARS ?? 0),
      USD: roundMoney(currencies.USD ?? 0),
    },
  };
}

function buildMetric(
  current: number,
  previous: number,
  mode: CompareMode,
  currencies?: { ARS: number; USD: number },
): MetricCompare {
  const c = roundMoney(current);
  const p = roundMoney(previous);
  if (p === 0 && c === 0) {
    return withCurrencies({ current: c, previous: p, changePct: 0, sentiment: 'neutral' }, currencies);
  }
  if (p === 0) {
    if (mode === 'higher_better') {
      return withCurrencies(
        {
          current: c,
          previous: p,
          changePct: null,
          sentiment: c > 0 ? 'positive' : 'neutral',
        },
        currencies,
      );
    }
    return withCurrencies(
      {
        current: c,
        previous: p,
        changePct: null,
        sentiment: c > 0 ? 'negative' : 'neutral',
      },
      currencies,
    );
  }
  const raw = ((c - p) / p) * 100;
  const changePct = Math.round(raw * 10) / 10;
  const same = c === p;
  const cur: MetricCompare = same
    ? { current: c, previous: p, changePct: 0, sentiment: 'neutral' }
    : {
        current: c,
        previous: p,
        changePct,
        sentiment: (mode === 'higher_better' ? c > p : c < p) ? 'positive' : 'negative',
      };
  return withCurrencies(cur, currencies);
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnerDashboard(
    tenantId: string,
    periodKind: DashboardPeriodKind,
    from?: string,
    to?: string,
  ): Promise<OwnerDashboardResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    const modules = tenant?.modules ?? [];
    const mod = new Set(modules.map((m) => m.toLowerCase()));
    const hasViajes = mod.has('viajes');
    const hasFacturacion = mod.has('facturacion') || hasViajes;
    const hasStock = mod.has('stock');
    const hasCombustible = mod.has('combustible');

    const resolved = resolveDashboardPeriod(periodKind, from, to);
    const meta = this.periodMeta(resolved);
    const sinFacturarRanges = sinFacturarArHalfOpenRanges(
      periodKind,
      resolved,
      from,
      to,
      new Date(),
    );

    const out: OwnerDashboardResponse = { period: meta };

    const [financieroResult, viajesResult, stockResult, cargasSospechosasResult, margenBajoResult] = await Promise.all([
      hasFacturacion
        ? Promise.all([
            this.sumFacturadoClienteSnapshot(tenantId),                                 // 0
            this.sumCobradoCliente(tenantId, resolved.start, resolved.end),             // 1
            this.sumAPagarTransportistas(tenantId, resolved.start, resolved.end),       // 2
            this.sumSinFacturarEnPeriodo(tenantId, sinFacturarRanges.current),          // 3
            this.sumFacturadoCliente(tenantId, resolved.prevStart, resolved.prevEnd),   // 4
            this.sumCobradoCliente(tenantId, resolved.prevStart, resolved.prevEnd),     // 5
            this.sumAPagarTransportistas(tenantId, resolved.prevStart, resolved.prevEnd), // 6
            this.sumSinFacturarEnPeriodo(tenantId, sinFacturarRanges.previous),         // 7
            this.hayViajeCostoExternoEnPeriodo(tenantId, resolved.start, resolved.end), // 8
            this.buildAlertas(tenantId),                                                // 9
            this.sumAPagarPorMoneda(tenantId, resolved.start, resolved.end),            // 10
            this.sumSinFacturarEnPeriodoMoneda(tenantId, sinFacturarRanges.current, 'USD'), // 11
            this.sumSinFacturarEnPeriodoMoneda(tenantId, sinFacturarRanges.current, 'ARS'), // 12
            this.sumFacturadoPorMonedaSnapshot(tenantId),                               // 13
            this.sumCobradoPorMoneda(tenantId, resolved.start, resolved.end),           // 14
          ])
        : null,
      hasViajes
        ? Promise.all([
            this.countEstadoEnVentana(tenantId, 'en_curso', resolved.start, resolved.end),
            this.countEstadoEnVentana(tenantId, 'en_curso', resolved.prevStart, resolved.prevEnd),
            this.countCompletadosEnVentana(tenantId, resolved.start, resolved.end),
            this.countCompletadosEnVentana(tenantId, resolved.prevStart, resolved.prevEnd),
            this.sumMontoSinFacturar(tenantId),
            this.countEstadoEnVentana(tenantId, 'finalizado_sin_facturar', resolved.start, resolved.end),
            this.countEstadosSnapshot(tenantId, [...ESTADOS_VIAJE_FACTURADO]),
            this.countCobradosEnPeriodo(tenantId, resolved.start, resolved.end),
          ])
        : null,
      hasStock ? this.getStockResumen(tenantId, resolved.start, resolved.end) : null,
      hasCombustible
        ? this.buildCargasSospechosasAlerta(tenantId, resolved.start, resolved.end)
        : null,
      hasViajes ? this.buildMargenBajoAlerta(tenantId, resolved.start, resolved.end) : null,
    ]);

    if (financieroResult) {
      const [
        facturado,
        cobrado,
        aPagar,
        sinFacturarPeriodo,
        facturadoPrev,
        cobradoPrev,
        aPagarPrev,
        sinFacturarPeriodoPrev,
        hayCostoExterno,
        alertas,
        aPagarMoneda,
        sinFacturarUSD,
        sinFacturarARS,
        facturadoMon,
        cobradoMon,
      ] = financieroResult;
      const facturadoMonTyped = facturadoMon as { ARS: number; USD: number };
      const cobradoMonTyped = cobradoMon as { ARS: number; USD: number };
      const facturadoM = buildMetric(facturado, facturadoPrev, 'higher_better', facturadoMonTyped);
      const cobradoM = buildMetric(cobrado, cobradoPrev, 'higher_better', cobradoMonTyped);
      const aPagarMon = aPagarMoneda as { ARS: number; USD: number };
      const aPagarM = buildMetric(aPagar, aPagarPrev, 'lower_better', {
        ARS: aPagarMon.ARS,
        USD: aPagarMon.USD,
      });
      const sinFacturarM = buildMetric(
        sinFacturarPeriodo,
        sinFacturarPeriodoPrev,
        'higher_better',
        {
          ARS: sinFacturarARS as number,
          USD: sinFacturarUSD as number,
        },
      );
      const margen = roundMoney(cobrado - aPagar);
      const margenPrev = roundMoney(cobradoPrev - aPagarPrev);
      const diff = roundMoney(facturado - aPagar);
      const diffPrev = roundMoney(facturadoPrev - aPagarPrev);
      out.financiero = {
        sinFacturarPeriodo: sinFacturarM,
        facturado: facturadoM,
        cobrado: cobradoM,
        aPagarTransportistas: aPagarM,
        margen: buildMetric(margen, margenPrev, 'higher_better'),
        mostrarDiferenciaNeta: hayCostoExterno > 0,
        diferenciaNetaEstimada: diff,
        diferenciaNetaCompare: buildMetric(diff, diffPrev, 'higher_better'),
      };
      const hasAlertas = alertas.facturasVencidas.cantidad > 0 || alertas.viajesSinFactura.cantidad > 0;
      out.alertas = hasAlertas ? alertas : null;
    }

    if (cargasSospechosasResult && cargasSospechosasResult.cantidad > 0) {
      const EMPTY_BLOQUE_FACTURAS = {
        cantidad: 0,
        montoTotal: 0,
        montosPorMoneda: { ARS: 0, USD: 0 },
        items: [] as Array<{ id: string; numero: string }>,
      };
      const EMPTY_BLOQUE_VIAJES = {
        cantidad: 0,
        montoTotal: 0,
        montosPorMoneda: { ARS: 0, USD: 0 },
        items: [] as Array<{
          id: string;
          numero: string;
          clienteNombre: string;
          fecha: string | null;
          origen: string | null;
          destino: string | null;
        }>,
      };
      out.alertas = {
        facturasVencidas: out.alertas?.facturasVencidas ?? EMPTY_BLOQUE_FACTURAS,
        viajesSinFactura: out.alertas?.viajesSinFactura ?? EMPTY_BLOQUE_VIAJES,
        cargasSospechosas: cargasSospechosasResult,
        margenBajo: out.alertas?.margenBajo,
      };
    }

    if (margenBajoResult && margenBajoResult.cantidad > 0) {
      const EMPTY_BLOQUE_FACTURAS = {
        cantidad: 0,
        montoTotal: 0,
        montosPorMoneda: { ARS: 0, USD: 0 },
        items: [] as Array<{ id: string; numero: string }>,
      };
      const EMPTY_BLOQUE_VIAJES = {
        cantidad: 0,
        montoTotal: 0,
        montosPorMoneda: { ARS: 0, USD: 0 },
        items: [] as Array<{
          id: string;
          numero: string;
          clienteNombre: string;
          fecha: string | null;
          origen: string | null;
          destino: string | null;
        }>,
      };
      out.alertas = {
        facturasVencidas: out.alertas?.facturasVencidas ?? EMPTY_BLOQUE_FACTURAS,
        viajesSinFactura: out.alertas?.viajesSinFactura ?? EMPTY_BLOQUE_VIAJES,
        cargasSospechosas: out.alertas?.cargasSospechosas,
        margenBajo: margenBajoResult,
      };
    }

    if (viajesResult) {
      const [enCursoNow, enCursoSnapshotPrev, completados, completadosPrev, sinFacturarMonto, sinFacturar, sinCobrar, cobrados] = viajesResult;
      out.viajes = {
        enCurso: buildMetric(enCursoNow, enCursoSnapshotPrev, 'higher_better'),
        completados: buildMetric(completados, completadosPrev, 'higher_better'),
        sinFacturarMonto: roundMoney(sinFacturarMonto),
        sinFacturar,
        sinCobrar,
        cobrados,
      };
    }

    if (stockResult) {
      out.stock = stockResult;
    }

    return out;
  }

  private periodMeta(resolved: ResolvedDashboardPeriod) {
    return {
      kind: resolved.kind,
      start: resolved.start.toISOString(),
      end: resolved.end.toISOString(),
      prevStart: resolved.prevStart.toISOString(),
      prevEnd: resolved.prevEnd.toISOString(),
    };
  }

  /**
   * Atribuye un viaje al período del dashboard: fecha de carga, finalización, alta
   * o emisión de la factura vinculada (misma lógica que métricas de cobro).
   */
  private whereViajeAtribuidoAlPeriodo(start: Date, end: Date): Prisma.ViajeWhereInput {
    return {
      OR: [
        { fechaCarga: { gte: start, lt: end } },
        { fechaCarga: null, fechaFinalizado: { gte: start, lt: end } },
        {
          fechaCarga: null,
          fechaFinalizado: null,
          createdAt: { gte: start, lt: end },
        },
        {
          facturaId: { not: null },
          factura: { fechaEmision: { gte: start, lt: end } },
        },
      ],
    };
  }

  /** Suma de `monto` en viajes facturados sin cobrar (pipeline actual). */
  private async sumFacturadoClienteSnapshot(tenantId: string): Promise<number> {
    const mon = await this.sumFacturadoPorMonedaSnapshot(tenantId);
    return roundMoney(mon.ARS + mon.USD);
  }

  /** Montos por moneda de viajes facturados sin cobrar (sin filtro de período). */
  private async sumFacturadoPorMonedaSnapshot(
    tenantId: string,
  ): Promise<{ ARS: number; USD: number }> {
    const groups = await this.prisma.viaje.groupBy({
      by: ['monedaMonto'],
      where: {
        tenantId,
        estado: { in: [...ESTADOS_VIAJE_FACTURADO] },
      },
      _sum: { monto: true },
    });
    const byMoneda: Record<string, number> = {};
    for (const g of groups) {
      const m = g.monedaMonto === 'USD' ? 'USD' : 'ARS';
      byMoneda[m] = roundMoney((byMoneda[m] ?? 0) + (g._sum.monto ?? 0));
    }
    return { ARS: byMoneda['ARS'] ?? 0, USD: byMoneda['USD'] ?? 0 };
  }

  /** Suma de `monto` en viajes facturados sin cobrar atribuidos al período (comparación histórica). */
  private async sumFacturadoCliente(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const mon = await this.sumFacturadoPorMoneda(tenantId, start, end);
    return roundMoney(mon.ARS + mon.USD);
  }

  private async sumFacturadoPorMoneda(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{ ARS: number; USD: number }> {
    const groups = await this.prisma.viaje.groupBy({
      by: ['monedaMonto'],
      where: {
        tenantId,
        estado: { in: [...ESTADOS_VIAJE_FACTURADO] },
        ...this.whereViajeAtribuidoAlPeriodo(start, end),
      },
      _sum: { monto: true },
    });
    const byMoneda: Record<string, number> = {};
    for (const g of groups) {
      const m = g.monedaMonto === 'USD' ? 'USD' : 'ARS';
      byMoneda[m] = roundMoney((byMoneda[m] ?? 0) + (g._sum.monto ?? 0));
    }
    return { ARS: byMoneda['ARS'] ?? 0, USD: byMoneda['USD'] ?? 0 };
  }

  private async sumCobradoPorMoneda(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{ ARS: number; USD: number }> {
    const [pagosRows, cobradosViaje] = await Promise.all([
      this.prisma.pago.findMany({
        where: {
          tenantId,
          fecha: { gte: start, lt: end },
          factura: { tipo: 'cliente' },
        },
        select: { importe: true, factura: { select: { moneda: true } } },
      }),
      this.prisma.viaje.findMany({
        where: {
          tenantId,
          estado: { in: [...ESTADOS_VIAJE_COBRADO] },
          facturaId: { not: null },
          factura: { tipo: 'cliente' },
          ...this.whereViajeAtribuidoAlPeriodo(start, end),
        },
        select: {
          monto: true,
          monedaMonto: true,
          facturaId: true,
          factura: { select: { pagos: { select: { id: true } } } },
        },
      }),
    ]);
    let ars = 0;
    let usd = 0;
    for (const p of pagosRows) {
      if (p.factura.moneda === 'USD') usd += p.importe;
      else ars += p.importe;
    }
    for (const v of cobradosViaje) {
      if (!v.facturaId) continue;
      if ((v.factura?.pagos?.length ?? 0) > 0) continue;
      const m = v.monedaMonto === 'USD' ? 'USD' : 'ARS';
      const amt = v.monto ?? 0;
      if (m === 'USD') usd += amt;
      else ars += amt;
    }
    return { ARS: roundMoney(ars), USD: roundMoney(usd) };
  }

  /**
   * Dinero cobrado en el período: pagos explícitos en factura + montos de viajes en
   * estado `cobrado` cuando no hay pagos cargados (mismo criterio operativo que Viajes).
   * Atribución al período: emisión de la factura o `fechaFinalizado` del viaje en la ventana.
   */
  private async sumCobradoCliente(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const [pagosSum, cobradosViaje] = await Promise.all([
      this.prisma.pago.aggregate({
        where: {
          tenantId,
          fecha: { gte: start, lt: end },
          factura: { tipo: 'cliente' },
        },
        _sum: { importe: true },
      }),
      this.prisma.viaje.findMany({
        where: {
          tenantId,
          estado: { in: [...ESTADOS_VIAJE_COBRADO] },
          facturaId: { not: null },
          factura: { tipo: 'cliente' },
          ...this.whereViajeAtribuidoAlPeriodo(start, end),
        },
        select: {
          monto: true,
          facturaId: true,
          factura: { select: { pagos: { select: { id: true } } } },
        },
      }),
    ]);
    let extra = 0;
    for (const v of cobradosViaje) {
      if (!v.facturaId) continue;
      if ((v.factura?.pagos?.length ?? 0) > 0) continue;
      extra += v.monto ?? 0;
    }
    return roundMoney((pagosSum._sum.importe ?? 0) + extra);
  }

  private async sumAPagarPorMoneda(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{ ARS: number; USD: number }> {
    const groups = await this.prisma.viaje.groupBy({
      by: ['monedaPrecioTransportistaExterno'],
      where: {
        tenantId,
        transportistaId: { not: null },
        precioTransportistaExterno: { gt: 0 },
        createdAt: { gte: start, lt: end },
      },
      _sum: { precioTransportistaExterno: true },
    });
    const byMoneda: Record<string, number> = {};
    for (const g of groups) {
      const m = g.monedaPrecioTransportistaExterno ?? 'ARS';
      byMoneda[m] = roundMoney(g._sum.precioTransportistaExterno ?? 0);
    }
    return { ARS: byMoneda['ARS'] ?? 0, USD: byMoneda['USD'] ?? 0 };
  }

  private async sumSinFacturarEnPeriodoMoneda(
    tenantId: string,
    range: SinFacturarArHalfOpen,
    moneda: string,
  ): Promise<number> {
    const tz = DASHBOARD_SIN_FACTURAR_TZ;
    const from = range.fromInclusive;
    const toEx = range.toExclusive;
    const rows = await this.prisma.$queryRaw<[{ s: unknown }]>(
      Prisma.sql`
        SELECT COALESCE(SUM(v."monto"), 0)::double precision AS s
        FROM "viajes" v
        WHERE v."tenantId" = ${tenantId}
        AND v."monedaMonto" = ${moneda}
        AND (
          (
            v."estado" = 'finalizado_sin_facturar'
            AND DATE(timezone(${tz}, COALESCE(v."fechaCarga", v."fechaFinalizado"))) >= ${from}::date
            AND DATE(timezone(${tz}, COALESCE(v."fechaCarga", v."fechaFinalizado"))) < ${toEx}::date
          )
          OR (
            v."estado" IN ('pendiente', 'en_curso')
            AND (
              (
                v."fechaCarga" IS NOT NULL
                AND DATE(timezone(${tz}, v."fechaCarga")) >= ${from}::date
                AND DATE(timezone(${tz}, v."fechaCarga")) < ${toEx}::date
              )
              OR (
                v."fechaCarga" IS NULL
                AND DATE(timezone(${tz}, v."createdAt")) >= ${from}::date
                AND DATE(timezone(${tz}, v."createdAt")) < ${toEx}::date
              )
            )
          )
        )
      `,
    );
    const raw = rows[0]?.s;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return roundMoney(Number.isFinite(n) ? n : 0);
  }

  private async sumAPagarTransportistas(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const agg = await this.prisma.viaje.aggregate({
      where: {
        tenantId,
        transportistaId: { not: null },
        precioTransportistaExterno: { gt: 0 },
        createdAt: { gte: start, lt: end },
      },
      _sum: { precioTransportistaExterno: true },
    });
    return roundMoney(agg._sum.precioTransportistaExterno ?? 0);
  }

  private async hayViajeCostoExternoEnPeriodo(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.prisma.viaje.count({
      where: {
        tenantId,
        transportistaId: { not: null },
        precioTransportistaExterno: { gt: 0 },
        fechaFinalizado: { gte: start, lt: end },
      },
    });
  }

  private async buildAlertas(tenantId: string) {
    const candidatas = await this.prisma.factura.findMany({
      where: {
        tenantId,
        tipo: 'cliente',
        fechaVencimiento: { not: null, lte: new Date() },
      },
      select: {
        id: true,
        numero: true,
        importe: true,
        moneda: true,
        fechaVencimiento: true,
        pagos: { select: { importe: true } },
        viajes: { select: { estado: true, monto: true } },
      },
    });
    const vencidas = candidatas.filter(
      (f) =>
        computeEstadoFacturaLectura({
          viajes: f.viajes,
          fechaVencimiento: f.fechaVencimiento,
          importeGuardado: f.importe,
          pagos: f.pagos,
        }) === 'vencida',
    );
    let montoVencidas = 0;
    let montoVencidasARS = 0;
    let montoVencidasUSD = 0;
    for (const f of vencidas) {
      const paid = f.pagos.reduce((s, p) => s + p.importe, 0);
      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      const pend = Math.max(0, roundMoney(importeOp - paid));
      if (pend > 0) {
        montoVencidas += pend;
        if (f.moneda === 'USD') montoVencidasUSD += pend;
        else montoVencidasARS += pend;
      }
    }
    const itemsVencidas: { id: string; numero: string }[] = [];
    for (const f of vencidas) {
      const paid = f.pagos.reduce((s, p) => s + p.importe, 0);
      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      if (importeOp - paid > 0.0001) {
        itemsVencidas.push({ id: f.id, numero: f.numero });
      }
    }
    const cantVencidas = itemsVencidas.length;

    const sinFactura = await this.prisma.viaje.findMany({
      where: {
        tenantId,
        estado: 'finalizado_sin_facturar',
      },
      select: {
        id: true,
        numero: true,
        monto: true,
        monedaMonto: true,
        clienteId: true,
        origen: true,
        destino: true,
        fechaCarga: true,
        fechaDescarga: true,
      },
    });
    let montoSinFacturaARS = 0;
    let montoSinFacturaUSD = 0;
    for (const v of sinFactura) {
      const amt = v.monto ?? 0;
      if (v.monedaMonto === 'USD') montoSinFacturaUSD += amt;
      else montoSinFacturaARS += amt;
    }
    montoSinFacturaARS = roundMoney(montoSinFacturaARS);
    montoSinFacturaUSD = roundMoney(montoSinFacturaUSD);
    const montoSinFactura = roundMoney(montoSinFacturaARS + montoSinFacturaUSD);

    const clienteIdsSinFactura = [...new Set(sinFactura.map((v) => v.clienteId))];
    const clientesSinFactura = clienteIdsSinFactura.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: clienteIdsSinFactura }, tenantId },
          select: { id: true, nombre: true },
        })
      : [];
    const nombreClienteSinFactura = new Map(clientesSinFactura.map((c) => [c.id, c.nombre]));

    const itemsSinFactura = sinFactura.map((v) => ({
      id: v.id,
      numero: v.numero ?? '',
      clienteNombre: nombreClienteSinFactura.get(v.clienteId) ?? 'Cliente',
      fecha: (v.fechaCarga ?? v.fechaDescarga)?.toISOString() ?? null,
      origen: v.origen,
      destino: v.destino,
    }));

    return {
      facturasVencidas: {
        cantidad: cantVencidas,
        montoTotal: roundMoney(montoVencidas),
        montosPorMoneda: {
          ARS: roundMoney(montoVencidasARS),
          USD: roundMoney(montoVencidasUSD),
        },
        items: itemsVencidas,
      },
      viajesSinFactura: {
        cantidad: sinFactura.length,
        montoTotal: montoSinFactura,
        montosPorMoneda: {
          ARS: montoSinFacturaARS,
          USD: montoSinFacturaUSD,
        },
        items: itemsSinFactura,
      },
    };
  }

  /**
   * Cargas de combustible marcadas `sospechoso` con `fecha` dentro del período elegido
   * en el dashboard. El límite superior nunca pasa de "ahora": el selector de período
   * (ej. "mes") cubre el mes calendario completo, pero una carga con fecha futura (dato
   * de prueba o error de tipeo) no es algo para "revisar ahora" — y así queda consistente
   * con el filtro de la pestaña Alertas de Combustible, que tampoco mira más allá de hoy.
   */
  private async buildCargasSospechosasAlerta(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{ cantidad: number; montoTotal: number }> {
    const now = new Date();
    const cappedEnd = end > now ? now : end;
    const agg = await this.prisma.cargaCombustible.aggregate({
      where: { tenantId, sospechoso: true, fecha: { gte: start, lt: cappedEnd } },
      _count: { _all: true },
      _sum: { importe: true },
    });
    return {
      cantidad: agg._count._all,
      montoTotal: roundMoney(agg._sum.importe ?? 0),
    };
  }

  /**
   * Viajes del período con margen bajo (< {@link UMBRAL_MARGEN_BAJO_PCT}%) o negativo.
   * Teaser para la campanita global: el detalle completo (por cliente/transportista/ruta,
   * separado por moneda) vive en GET /dashboard/financiero. `montoTotal` solo suma el
   * margen negativo en ARS para no mezclar monedas en un único número.
   */
  private async buildMargenBajoAlerta(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{ cantidad: number; montoTotal: number }> {
    // El límite superior nunca pasa de "ahora": el selector de período (ej. "mes") cubre
    // el mes calendario completo, pero la pestaña Alertas de GET /dashboard/financiero
    // (igual que Combustible) tampoco mira más allá de hoy — mismo criterio que
    // `buildCargasSospechosasAlerta`, para que el conteo de la campanita coincida con
    // el de la pestaña.
    const now = new Date();
    const cappedEnd = end > now ? now : end;
    const viajes = await this.prisma.viaje.findMany({
      where: {
        tenantId,
        estado: { not: 'cancelado' },
        OR: [
          { fechaCarga: { gte: start, lte: cappedEnd } },
          { fechaCarga: null, fechaFinalizado: { gte: start, lte: cappedEnd } },
          { fechaCarga: null, fechaFinalizado: null, createdAt: { gte: start, lte: cappedEnd } },
        ],
      },
      select: {
        monto: true,
        monedaMonto: true,
        precioTransportistaExterno: true,
        monedaPrecioTransportistaExterno: true,
        otrosGastos: true,
        gananciaBrutaManual: true,
        monedaGananciaBrutaManual: true,
      },
    });

    let cantidad = 0;
    let montoNegativoArs = 0;
    for (const v of viajes) {
      const monto = v.monto ?? 0;
      if (monto <= 0) continue;
      const g = buildGananciaBrutaResumen(v);
      let margenValor: number | null = null;
      let margenMoneda: 'ARS' | 'USD' = 'ARS';
      let margenPct: number | null = null;

      if (g.gananciaCalculada != null) {
        margenValor = g.gananciaCalculada;
        margenMoneda = g.monedaGananciaCalculada ?? 'ARS';
        margenPct = roundMoney((margenValor / monto) * 100);
      } else if (g.gananciaBrutaManual != null) {
        margenValor = g.gananciaBrutaManual;
        margenMoneda = g.monedaGananciaBrutaManual ?? 'ARS';
      } else {
        continue;
      }

      const esAlerta = margenValor < 0 || (margenPct != null && margenPct < UMBRAL_MARGEN_BAJO_PCT);
      if (!esAlerta) continue;
      cantidad += 1;
      if (margenValor < 0 && margenMoneda === 'ARS') montoNegativoArs += -margenValor;
    }

    return { cantidad, montoTotal: roundMoney(montoNegativoArs) };
  }

  /**
   * Cuenta viajes con el estado dado cuya fecha de atribución al período cae en [start, end).
   * Atribución: fechaCarga → fechaFinalizado → createdAt (primer campo no nulo).
   */
  private async countEstadoEnVentana(
    tenantId: string,
    estado: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.countEstadosEnVentana(tenantId, [estado], start, end);
  }

  /** Conteo por estado(s) con atribución al período alineada al resumen financiero. */
  private async countEstadosEnVentana(
    tenantId: string,
    estados: string[],
    start: Date,
    end: Date,
  ): Promise<number> {
    if (estados.length === 0) return 0;
    return this.prisma.viaje.count({
      where: {
        tenantId,
        estado: { in: estados },
        ...this.whereViajeAtribuidoAlPeriodo(start, end),
      },
    });
  }

  /** Conteo snapshot por estado(s) (pipeline operativo actual). */
  private countEstadosSnapshot(tenantId: string, estados: string[]): Promise<number> {
    if (estados.length === 0) return Promise.resolve(0);
    return this.prisma.viaje.count({
      where: { tenantId, estado: { in: estados } },
    });
  }

  /**
   * Viajes cobrados en el período: estado `cobrado` con atribución temporal o cobro
   * registrado en factura de cliente (misma lógica que `sumCobradoCliente`).
   */
  private countCobradosEnPeriodo(tenantId: string, start: Date, end: Date): Promise<number> {
    return this.prisma.viaje.count({
      where: {
        tenantId,
        facturaId: { not: null },
        factura: { tipo: 'cliente' },
        OR: [
          {
            estado: { in: [...ESTADOS_VIAJE_COBRADO] },
            ...this.whereViajeAtribuidoAlPeriodo(start, end),
          },
          {
            factura: {
              pagos: { some: { fecha: { gte: start, lt: end } } },
            },
          },
        ],
      },
    });
  }

  /** Viajes “en curso” en el instante `at` (estado actual en BD + ventana temporal). */
  private async countEnCursoAt(tenantId: string, at: Date): Promise<number> {
    return this.prisma.viaje.count({
      where: {
        tenantId,
        estado: 'en_curso',
        createdAt: { lte: at },
        OR: [{ fechaFinalizado: null }, { fechaFinalizado: { gt: at } }],
      },
    });
  }

  private async countCompletadosEnVentana(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.prisma.viaje.count({
      where: {
        tenantId,
        estado: { in: [...VIAJE_ESTADOS_COMPLETADOS_TABLERO] },
        fechaFinalizado: { gte: start, lt: end },
      },
    });
  }

  /**
   * Monto sin facturar atribuible al período por **fecha calendario en Argentina**:
   * - `finalizado_sin_facturar`: `fechaCarga` o, si no hay, `fechaFinalizado`;
   * - `pendiente` / `en_curso`: `fechaCarga` o, si no hay, `createdAt`.
   */
  private async sumSinFacturarEnPeriodo(
    tenantId: string,
    range: SinFacturarArHalfOpen,
  ): Promise<number> {
    const tz = DASHBOARD_SIN_FACTURAR_TZ;
    const from = range.fromInclusive;
    const toEx = range.toExclusive;
    const rows = await this.prisma.$queryRaw<[{ s: unknown }]>(
      Prisma.sql`
        SELECT COALESCE(SUM(v."monto"), 0)::double precision AS s
        FROM "viajes" v
        WHERE v."tenantId" = ${tenantId}
        AND (
          (
            v."estado" = 'finalizado_sin_facturar'
            AND DATE(timezone(${tz}, COALESCE(v."fechaCarga", v."fechaFinalizado"))) >= ${from}::date
            AND DATE(timezone(${tz}, COALESCE(v."fechaCarga", v."fechaFinalizado"))) < ${toEx}::date
          )
          OR (
            v."estado" IN ('pendiente', 'en_curso')
            AND (
              (
                v."fechaCarga" IS NOT NULL
                AND DATE(timezone(${tz}, v."fechaCarga")) >= ${from}::date
                AND DATE(timezone(${tz}, v."fechaCarga")) < ${toEx}::date
              )
              OR (
                v."fechaCarga" IS NULL
                AND DATE(timezone(${tz}, v."createdAt")) >= ${from}::date
                AND DATE(timezone(${tz}, v."createdAt")) < ${toEx}::date
              )
            )
          )
        )
      `,
    );
    const raw = rows[0]?.s;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return roundMoney(Number.isFinite(n) ? n : 0);
  }

  /** Monto total en viajes aún sin facturar (pipeline operativo actual). */
  private async sumMontoSinFacturar(tenantId: string): Promise<number> {
    const agg = await this.prisma.viaje.aggregate({
      where: {
        tenantId,
        estado: {
          in: ['pendiente', 'en_curso', 'finalizado_sin_facturar'],
        },
      },
      _sum: { monto: true },
    });
    return agg._sum.monto ?? 0;
  }

  /** Snapshot de stock para el dashboard: productos/clientes activos + ingresos/egresos del período. */
  private async getStockResumen(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{ totalProductos: number; totalClientes: number; ingresosHoy: number; egresosHoy: number }> {
    const [totalProductos, totalClientes, ingresosHoy, egresosHoy] = await Promise.all([
      this.prisma.producto.count({ where: { tenantId, activo: true } }),
      this.prisma.cliente.count({ where: { tenantId } }),
      this.prisma.stockOperacion.count({
        where: { tenantId, tipo: 'ingreso', fecha: { gte: start, lt: end } },
      }),
      this.prisma.stockOperacion.count({
        where: { tenantId, tipo: 'egreso', fecha: { gte: start, lt: end } },
      }),
    ]);

    return { totalProductos, totalClientes, ingresosHoy, egresosHoy };
  }
}
