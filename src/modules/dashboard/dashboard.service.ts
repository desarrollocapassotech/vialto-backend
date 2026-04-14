import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  resolveDashboardPeriod,
  type DashboardPeriodKind,
  type ResolvedDashboardPeriod,
} from './dashboard-period';

export type MetricCompare = {
  current: number;
  previous: number;
  changePct: number | null;
  sentiment: 'positive' | 'negative' | 'neutral';
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
    facturado: MetricCompare;
    cobrado: MetricCompare;
    aPagarTransportistas: MetricCompare;
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
  if (same) {
    return { current: c, previous: p, changePct: 0, sentiment: 'neutral' };
  }
  const improved =
    mode === 'higher_better' ? c > p : c < p;
  return {
    current: c,
    previous: p,
    changePct,
    sentiment: improved ? 'positive' : 'negative',
  };
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
    const hasFacturacion = mod.has('facturacion');
    const hasViajes = mod.has('viajes');

    const resolved = resolveDashboardPeriod(periodKind, from, to);
    const meta = this.periodMeta(resolved);

    const out: OwnerDashboardResponse = { period: meta };

    if (hasFacturacion) {
      const [
        facturado,
        cobrado,
        aPagar,
        facturadoPrev,
        cobradoPrev,
        aPagarPrev,
        hayCostoExterno,
        alertas,
      ] = await Promise.all([
        this.sumFacturadoCliente(tenantId, resolved.start, resolved.end),
        this.sumCobradoCliente(tenantId, resolved.start, resolved.end),
        this.sumAPagarTransportistas(tenantId, resolved.start, resolved.end),
        this.sumFacturadoCliente(tenantId, resolved.prevStart, resolved.prevEnd),
        this.sumCobradoCliente(tenantId, resolved.prevStart, resolved.prevEnd),
        this.sumAPagarTransportistas(tenantId, resolved.prevStart, resolved.prevEnd),
        this.hayViajeCostoExternoEnPeriodo(tenantId, resolved.start, resolved.end),
        this.buildAlertas(tenantId),
      ]);

      const facturadoM = buildMetric(facturado, facturadoPrev, 'higher_better');
      const cobradoM = buildMetric(cobrado, cobradoPrev, 'higher_better');
      const aPagarM = buildMetric(aPagar, aPagarPrev, 'lower_better');

      const diff = roundMoney(facturado - aPagar);
      const diffPrev = roundMoney(facturadoPrev - aPagarPrev);
      const diffCompare = buildMetric(diff, diffPrev, 'higher_better');

      out.financiero = {
        facturado: facturadoM,
        cobrado: cobradoM,
        aPagarTransportistas: aPagarM,
        mostrarDiferenciaNeta: hayCostoExterno > 0,
        diferenciaNetaEstimada: diff,
        diferenciaNetaCompare: diffCompare,
      };

      const hasAlertas =
        alertas.facturasVencidas.cantidad > 0 ||
        alertas.viajesSinFactura.cantidad > 0;
      out.alertas = hasAlertas ? alertas : null;
    }

    if (hasViajes) {
      const [
        enCursoNow,
        enCursoSnapshotPrev,
        completados,
        completadosPrev,
        sinFacturarMonto,
      ] = await Promise.all([
        this.prisma.viaje.count({
          where: { tenantId, estado: 'en_curso' },
        }),
        this.countEnCursoAt(tenantId, new Date(resolved.prevEnd.getTime() - 1)),
        this.countCompletadosEnVentana(tenantId, resolved.start, resolved.end),
        this.countCompletadosEnVentana(
          tenantId,
          resolved.prevStart,
          resolved.prevEnd,
        ),
        this.sumMontoSinFacturar(tenantId),
      ]);

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

  private async sumAPagarTransportistas(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const facturas = await this.prisma.factura.findMany({
      where: {
        tenantId,
        tipo: 'transportista_externo',
        fechaEmision: { gte: start, lt: end },
        estado: { in: ['pendiente', 'vencida'] },
      },
      select: { importe: true, pagos: { select: { importe: true } } },
    });
    return facturas.reduce((acc, f) => {
      const paid = f.pagos.reduce((s, p) => s + p.importe, 0);
      return acc + Math.max(0, roundMoney(f.importe - paid));
    }, 0);
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
    const vencidas = await this.prisma.factura.findMany({
      where: {
        tenantId,
        tipo: 'cliente',
        estado: 'vencida',
      },
      select: { importe: true, pagos: { select: { importe: true } } },
    });
    let montoVencidas = 0;
    for (const f of vencidas) {
      const paid = f.pagos.reduce((s, p) => s + p.importe, 0);
      const pend = Math.max(0, roundMoney(f.importe - paid));
      if (pend > 0) montoVencidas += pend;
    }
    const cantVencidas = vencidas.filter((f) => {
      const paid = f.pagos.reduce((s, p) => s + p.importe, 0);
      return f.importe - paid > 0.0001;
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
        estado: { in: ['finalizado_sin_facturar', 'facturado_sin_cobrar', 'cobrado'] },
        fechaFinalizado: { gte: start, lt: end },
      },
    });
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
