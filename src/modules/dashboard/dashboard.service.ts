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
} from '../facturacion/factura-estado-lectura';

export type MetricCompare = {
  current: number;
  previous: number;
  changePct: number | null;
  sentiment: 'positive' | 'negative' | 'neutral';
  /** Desglose por moneda del período actual. Solo presente en métricas derivadas de viajes. */
  currencies?: { ARS?: number; USD?: number };
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
    facturado: MetricCompare;
    cobrado: MetricCompare;
    aPagarTransportistas: MetricCompare;
    margen: MetricCompare;
    mostrarDiferenciaNeta: boolean;
    diferenciaNetaEstimada: number;
    diferenciaNetaCompare: MetricCompare;
  };
  alertas?: {
    facturasVencidas: { cantidad: number; montoTotal: number };
    viajesSinFactura: { cantidad: number; montoTotal: number };
  } | null;
  viajes?: {
    enCurso: MetricCompare;
    completados: MetricCompare;
    /** Suma de montos (snapshot actual, no filtrado por el período del selector). */
    sinFacturarMonto: number;
  };
};

type CompareMode = 'higher_better' | 'lower_better';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildMetric(
  current: number,
  previous: number,
  mode: CompareMode,
  currencies?: { ARS?: number; USD?: number },
): MetricCompare {
  const c = roundMoney(current);
  const p = roundMoney(previous);
  if (p === 0 && c === 0) {
    return { current: c, previous: p, changePct: 0, sentiment: 'neutral' };
  }
  if (p === 0) {
    if (mode === 'higher_better') {
      return {
        current: c,
        previous: p,
        changePct: null,
        sentiment: c > 0 ? 'positive' : 'neutral',
      };
    }
    return {
      current: c,
      previous: p,
      changePct: null,
      sentiment: c > 0 ? 'negative' : 'neutral',
    };
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
  if (currencies) {
    cur.currencies = {
      ...(currencies.ARS != null && currencies.ARS > 0 ? { ARS: currencies.ARS } : {}),
      ...(currencies.USD != null && currencies.USD > 0 ? { USD: currencies.USD } : {}),
    };
  }
  return cur;
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

    const [financieroResult, viajesResult] = await Promise.all([
      hasFacturacion
        ? Promise.all([
            this.sumFacturadoCliente(tenantId, resolved.start, resolved.end),           // 0
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
          ])
        : null,
      hasViajes
        ? Promise.all([
            this.prisma.viaje.count({ where: { tenantId, estado: 'en_curso' } }),
            this.countEnCursoAt(tenantId, new Date(resolved.prevEnd.getTime() - 1)),
            this.countCompletadosEnVentana(tenantId, resolved.start, resolved.end),
            this.countCompletadosEnVentana(tenantId, resolved.prevStart, resolved.prevEnd),
            this.sumMontoSinFacturar(tenantId),
          ])
        : null,
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
      ] = financieroResult;
      const sinFacturarARS = roundMoney(sinFacturarPeriodo - (sinFacturarUSD as number));
      const facturadoM = buildMetric(facturado, facturadoPrev, 'higher_better');
      const cobradoM = buildMetric(cobrado, cobradoPrev, 'higher_better');
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
          ARS: sinFacturarARS,
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

    if (viajesResult) {
      const [enCursoNow, enCursoSnapshotPrev, completados, completadosPrev, sinFacturarMonto] = viajesResult;
      out.viajes = {
        enCurso: buildMetric(enCursoNow, enCursoSnapshotPrev, 'higher_better'),
        completados: buildMetric(completados, completadosPrev, 'higher_better'),
        sinFacturarMonto: roundMoney(sinFacturarMonto),
      };
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

  private async sumFacturadoCliente(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const agg = await this.prisma.factura.aggregate({
      where: {
        tenantId,
        tipo: 'cliente',
        fechaEmision: { gte: start, lt: end },
      },
      _sum: { importe: true },
    });
    return agg._sum.importe ?? 0;
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
          estado: 'cobrado',
          facturaId: { not: null },
          factura: { tipo: 'cliente' },
          OR: [
            { factura: { fechaEmision: { gte: start, lt: end } } },
            { fechaFinalizado: { gte: start, lt: end } },
          ],
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
        importe: true,
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
    for (const f of vencidas) {
      const paid = f.pagos.reduce((s, p) => s + p.importe, 0);
      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      const pend = Math.max(0, roundMoney(importeOp - paid));
      if (pend > 0) montoVencidas += pend;
    }
    const cantVencidas = vencidas.filter((f) => {
      const paid = f.pagos.reduce((s, p) => s + p.importe, 0);
      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      return importeOp - paid > 0.0001;
    }).length;

    const sinFactura = await this.prisma.viaje.findMany({
      where: {
        tenantId,
        estado: 'finalizado_sin_facturar',
      },
      select: { monto: true },
    });
    const montoSinFactura = sinFactura.reduce(
      (a, v) => a + (v.monto ?? 0),
      0,
    );

    return {
      facturasVencidas: {
        cantidad: cantVencidas,
        montoTotal: roundMoney(montoVencidas),
      },
      viajesSinFactura: {
        cantidad: sinFactura.length,
        montoTotal: roundMoney(montoSinFactura),
      },
    };
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
}
