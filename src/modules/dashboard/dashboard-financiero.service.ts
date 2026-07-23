import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  buildGananciaBrutaResumen,
  UMBRAL_MARGEN_BAJO_PCT,
} from '../viajes/viaje-ganancia-bruta.util';
import { VIAJE_ESTADOS_FINALES } from '../viajes/viaje-estados';
import { importeOperativoFactura } from '../../shared/util/factura-estado-lectura';

export type Money = { ARS: number; USD: number };

export type FinancieroMargenPorEntidad = {
  id: string;
  nombre: string;
  cantViajes: number;
  facturado: Money;
  margen: Money;
  /** Solo cuando todos los viajes de la entidad calculan margen automático en una única moneda dominante. */
  margenPct: number | null;
};

export type FinancieroMargenAlerta = {
  viajeId: string;
  numero: string;
  clienteNombre: string;
  transportistaNombre: string | null;
  facturado: number;
  moneda: 'ARS' | 'USD';
  margen: number;
  margenPct: number | null;
};

export type FinancieroMargenPorRuta = {
  clave: string;
  cantViajes: number;
  margenPctPromedio: number | null;
};

export type FinancieroDashboardResponse = {
  periodo: { from: string; to: string };
  margen?: {
    resumen: {
      facturado: Money;
      margen: Money;
      cantViajesConMargenAuto: number;
      cantViajesSinDatos: number;
      margenPctPromedio: number | null;
    };
    porCliente: FinancieroMargenPorEntidad[];
    porTransportista: FinancieroMargenPorEntidad[];
    porRuta: FinancieroMargenPorRuta[];
    porTipoCarga: FinancieroMargenPorRuta[];
    alertas: FinancieroMargenAlerta[];
  };
  viajesFunnel?: {
    porEstado: Array<{ estado: string; cantidad: number }>;
    /** Viajes finalizados con transportista y costo cargado, ya pagados por completo. */
    liquidados: {
      cantidad: number;
      montoTotal: Money;
    };
    sinLiquidar: {
      cantidad: number;
      montoPendiente: Money;
      items: Array<{ id: string; numero: string; transportistaNombre: string | null }>;
    };
    sinFacturar: {
      cantidad: number;
      montoTotal: Money;
      items: Array<{ id: string; numero: string; clienteNombre: string }>;
    };
  };
  liquidaciones?: {
    aPagarPorTransportista: Array<{
      transportistaId: string;
      nombre: string;
      acordado: Money;
      pagado: Money;
      pendiente: Money;
      cantViajes: number;
    }>;
    rankingPorLiquidado: Array<{
      transportistaId: string;
      nombre: string;
      liquido: number;
      cantLiquidaciones: number;
    }>;
    cvlpPorPeriodo: Array<{
      periodo: string;
      cantLiquidaciones: number;
      bruto: number;
      comision: number;
      gastosAdmin: number;
      liquido: number;
    }>;
  };
  facturacion?: {
    porTipoComprobante: {
      A: { cantidad: number; monto: number };
      B: { cantidad: number; monto: number };
      sinArca: { cantidad: number; monto: number };
    };
    rankingClientes: Array<{
      clienteId: string;
      nombre: string;
      facturado: Money;
      cobrado: Money;
      pendienteCobro: Money;
      cantFacturas: number;
    }>;
    pendientesEmitir: {
      cantidad: number;
      montoTotal: Money;
      items: Array<{ id: string; numero: string; clienteNombre: string }>;
    };
    facturadoVsCobrado: {
      facturado: Money;
      cobrado: Money;
      pendienteCobro: Money;
    };
  };
  cashflow?: {
    aCobrarProyeccion: Array<{ bucket: string; monto: Money }>;
    aPagarPendienteTotal: Money;
    diferenciaTiming: {
      promedioDiasCobro: number | null;
      promedioDiasPago: number | null;
      alerta: boolean;
    };
  };
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyMoney(): Money {
  return { ARS: 0, USD: 0 };
}

function addMoney(m: Money, moneda: string, monto: number): void {
  if (moneda === 'USD') m.USD = roundMoney(m.USD + monto);
  else m.ARS = roundMoney(m.ARS + monto);
}

function startOfDayLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function endOfDayLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
}

type ViajeMargenRow = {
  id: string;
  numero: string | null;
  clienteId: string;
  transportistaId: string | null;
  monto: number | null;
  monedaMonto: string;
  precioTransportistaExterno: number | null;
  monedaPrecioTransportistaExterno: string;
  otrosGastos: unknown;
  gananciaBrutaManual: number | null;
  monedaGananciaBrutaManual: string | null;
  origen: string | null;
  destino: string | null;
  detalleCarga: string | null;
};

@Injectable()
export class DashboardFinancieroService {
  constructor(private readonly prisma: PrismaService) {}

  async getFinancieroDashboard(
    tenantId: string,
    from?: string,
    to?: string,
  ): Promise<FinancieroDashboardResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    const mod = new Set((tenant?.modules ?? []).map((m) => m.toLowerCase()));
    const hasViajes = mod.has('viajes');
    const hasFacturacion = mod.has('facturacion') || hasViajes;
    const hasIntegracionArca = mod.has('integracion-arca');

    const now = new Date();
    const start = from ? startOfDayLocal(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = to ? endOfDayLocal(to) : now;

    const out: FinancieroDashboardResponse = {
      periodo: { from: start.toISOString(), to: end.toISOString() },
    };

    const whereViajeAtribuido = (s: Date, e: Date) => ({
      OR: [
        { fechaCarga: { gte: s, lte: e } },
        { fechaCarga: null, fechaFinalizado: { gte: s, lte: e } },
        { fechaCarga: null, fechaFinalizado: null, createdAt: { gte: s, lte: e } },
      ],
    });

    const [margen, viajesFunnel, liquidaciones, facturacion, cashflow] = await Promise.all([
      hasViajes ? this.buildMargen(tenantId, start, end, whereViajeAtribuido) : null,
      hasViajes ? this.buildViajesFunnel(tenantId, start, end, whereViajeAtribuido) : null,
      hasViajes && hasIntegracionArca
        ? this.buildLiquidaciones(tenantId, start, end, whereViajeAtribuido)
        : null,
      hasFacturacion ? this.buildFacturacion(tenantId, start, end) : null,
      hasViajes && hasFacturacion ? this.buildCashflow(tenantId) : null,
    ]);

    if (margen) out.margen = margen;
    if (viajesFunnel) out.viajesFunnel = viajesFunnel;
    if (liquidaciones) out.liquidaciones = liquidaciones;
    if (facturacion) out.facturacion = facturacion;
    if (cashflow) out.cashflow = cashflow;

    return out;
  }

  // ── Margen ────────────────────────────────────────────────────────────────

  private async buildMargen(
    tenantId: string,
    start: Date,
    end: Date,
    whereViajeAtribuido: (s: Date, e: Date) => Record<string, unknown>,
  ): Promise<NonNullable<FinancieroDashboardResponse['margen']>> {
    const viajes = await this.prisma.viaje.findMany({
      where: {
        tenantId,
        estado: { not: 'cancelado' },
        ...whereViajeAtribuido(start, end),
      },
      select: {
        id: true,
        numero: true,
        clienteId: true,
        transportistaId: true,
        monto: true,
        monedaMonto: true,
        precioTransportistaExterno: true,
        monedaPrecioTransportistaExterno: true,
        otrosGastos: true,
        gananciaBrutaManual: true,
        monedaGananciaBrutaManual: true,
        origen: true,
        destino: true,
        detalleCarga: true,
      },
    });

    const clienteIds = [...new Set(viajes.map((v) => v.clienteId))];
    const transportistaIds = [
      ...new Set(viajes.map((v) => v.transportistaId).filter((x): x is string => !!x)),
    ];
    const [clientes, transportistas] = await Promise.all([
      clienteIds.length
        ? this.prisma.cliente.findMany({
            where: { id: { in: clienteIds }, tenantId },
            select: { id: true, nombre: true },
          })
        : Promise.resolve([]),
      transportistaIds.length
        ? this.prisma.transportista.findMany({
            where: { id: { in: transportistaIds }, tenantId },
            select: { id: true, nombre: true },
          })
        : Promise.resolve([]),
    ]);
    const nombreCliente = new Map(clientes.map((c) => [c.id, c.nombre]));
    const nombreTransportista = new Map(transportistas.map((t) => [t.id, t.nombre]));

    const resumen = { facturado: emptyMoney(), margen: emptyMoney() };
    let cantConMargenAuto = 0;
    let cantSinDatos = 0;
    let sumaPct = 0;
    let cantPct = 0;

    const porClienteMap = new Map<string, { facturado: Money; margen: Money; cant: number; sumaPct: number; cantPct: number }>();
    const porTransportistaMap = new Map<string, { facturado: Money; margen: Money; cant: number; sumaPct: number; cantPct: number }>();
    const porRutaMap = new Map<string, { cant: number; sumaPct: number; cantPct: number }>();
    const porTipoCargaMap = new Map<string, { cant: number; sumaPct: number; cantPct: number }>();
    const alertas: FinancieroMargenAlerta[] = [];

    for (const v of viajes as ViajeMargenRow[]) {
      const monto = v.monto ?? 0;
      if (monto <= 0) {
        cantSinDatos += 1;
        continue;
      }
      const monedaMonto = v.monedaMonto === 'USD' ? 'USD' : 'ARS';
      addMoney(resumen.facturado, monedaMonto, monto);

      const g = buildGananciaBrutaResumen(v);
      let margenValor: number | null = null;
      let margenMoneda: 'ARS' | 'USD' = monedaMonto;
      let margenPct: number | null = null;

      if (g.gananciaCalculada != null) {
        margenValor = g.gananciaCalculada;
        margenMoneda = g.monedaGananciaCalculada ?? monedaMonto;
        margenPct = monto > 0 ? roundMoney((margenValor / monto) * 100) : null;
        cantConMargenAuto += 1;
        if (margenPct != null) {
          sumaPct += margenPct;
          cantPct += 1;
        }
      } else if (g.gananciaBrutaManual != null) {
        margenValor = g.gananciaBrutaManual;
        margenMoneda = g.monedaGananciaBrutaManual ?? monedaMonto;
      } else {
        cantSinDatos += 1;
      }

      if (margenValor != null) {
        addMoney(resumen.margen, margenMoneda, margenValor);

        const clienteNombre = nombreCliente.get(v.clienteId) ?? 'Cliente';
        const cli = porClienteMap.get(v.clienteId) ?? {
          facturado: emptyMoney(),
          margen: emptyMoney(),
          cant: 0,
          sumaPct: 0,
          cantPct: 0,
        };
        addMoney(cli.facturado, monedaMonto, monto);
        addMoney(cli.margen, margenMoneda, margenValor);
        cli.cant += 1;
        if (margenPct != null) {
          cli.sumaPct += margenPct;
          cli.cantPct += 1;
        }
        porClienteMap.set(v.clienteId, cli);

        if (v.transportistaId) {
          const transportistaNombre = nombreTransportista.get(v.transportistaId) ?? 'Transportista';
          const tr = porTransportistaMap.get(v.transportistaId) ?? {
            facturado: emptyMoney(),
            margen: emptyMoney(),
            cant: 0,
            sumaPct: 0,
            cantPct: 0,
          };
          addMoney(tr.facturado, monedaMonto, monto);
          addMoney(tr.margen, margenMoneda, margenValor);
          tr.cant += 1;
          if (margenPct != null) {
            tr.sumaPct += margenPct;
            tr.cantPct += 1;
          }
          porTransportistaMap.set(v.transportistaId, tr);
        }

        const claveRuta = `${(v.origen ?? '').trim() || '—'} → ${(v.destino ?? '').trim() || '—'}`;
        const ruta = porRutaMap.get(claveRuta) ?? { cant: 0, sumaPct: 0, cantPct: 0 };
        ruta.cant += 1;
        if (margenPct != null) {
          ruta.sumaPct += margenPct;
          ruta.cantPct += 1;
        }
        porRutaMap.set(claveRuta, ruta);

        const claveTipoCarga = (v.detalleCarga ?? '').trim() || 'Sin especificar';
        const tipoCarga = porTipoCargaMap.get(claveTipoCarga) ?? { cant: 0, sumaPct: 0, cantPct: 0 };
        tipoCarga.cant += 1;
        if (margenPct != null) {
          tipoCarga.sumaPct += margenPct;
          tipoCarga.cantPct += 1;
        }
        porTipoCargaMap.set(claveTipoCarga, tipoCarga);

        const esAlerta = margenValor < 0 || (margenPct != null && margenPct < UMBRAL_MARGEN_BAJO_PCT);
        if (esAlerta) {
          alertas.push({
            viajeId: v.id,
            numero: v.numero ?? '',
            clienteNombre,
            transportistaNombre: v.transportistaId
              ? (nombreTransportista.get(v.transportistaId) ?? 'Transportista')
              : null,
            facturado: monto,
            moneda: monedaMonto,
            margen: margenValor,
            margenPct,
          });
        }
      }
    }

    alertas.sort((a, b) => {
      const av = a.margenPct ?? (a.margen < 0 ? -9999 : 0);
      const bv = b.margenPct ?? (b.margen < 0 ? -9999 : 0);
      return av - bv;
    });

    function toEntidades(
      map: Map<string, { facturado: Money; margen: Money; cant: number; sumaPct: number; cantPct: number }>,
      nombres: Map<string, string>,
    ): FinancieroMargenPorEntidad[] {
      return [...map.entries()]
        .map(([id, v]) => ({
          id,
          nombre: nombres.get(id) ?? '—',
          cantViajes: v.cant,
          facturado: v.facturado,
          margen: v.margen,
          margenPct: v.cantPct > 0 ? roundMoney(v.sumaPct / v.cantPct) : null,
        }))
        .sort((a, b) => b.margen.ARS + b.margen.USD - (a.margen.ARS + a.margen.USD))
        .slice(0, 20);
    }

    function toRutas(map: Map<string, { cant: number; sumaPct: number; cantPct: number }>): FinancieroMargenPorRuta[] {
      return [...map.entries()]
        .map(([clave, v]) => ({
          clave,
          cantViajes: v.cant,
          margenPctPromedio: v.cantPct > 0 ? roundMoney(v.sumaPct / v.cantPct) : null,
        }))
        .sort((a, b) => b.cantViajes - a.cantViajes)
        .slice(0, 15);
    }

    return {
      resumen: {
        facturado: resumen.facturado,
        margen: resumen.margen,
        cantViajesConMargenAuto: cantConMargenAuto,
        cantViajesSinDatos: cantSinDatos,
        margenPctPromedio: cantPct > 0 ? roundMoney(sumaPct / cantPct) : null,
      },
      porCliente: toEntidades(porClienteMap, nombreCliente),
      porTransportista: toEntidades(porTransportistaMap, nombreTransportista),
      porRuta: toRutas(porRutaMap),
      porTipoCarga: toRutas(porTipoCargaMap),
      alertas: alertas.slice(0, 30),
    };
  }

  // ── Funnel de viajes ─────────────────────────────────────────────────────

  private async buildViajesFunnel(
    tenantId: string,
    start: Date,
    end: Date,
    whereViajeAtribuido: (s: Date, e: Date) => Record<string, unknown>,
  ): Promise<NonNullable<FinancieroDashboardResponse['viajesFunnel']>> {
    const viajes = await this.prisma.viaje.findMany({
      where: { tenantId, ...whereViajeAtribuido(start, end) },
      select: {
        id: true,
        numero: true,
        estado: true,
        clienteId: true,
        transportistaId: true,
        precioTransportistaExterno: true,
        monedaPrecioTransportistaExterno: true,
        pagosTransportista: true,
      },
    });

    const porEstadoMap = new Map<string, number>();
    for (const v of viajes) {
      porEstadoMap.set(v.estado, (porEstadoMap.get(v.estado) ?? 0) + 1);
    }

    const finales = new Set<string>(VIAJE_ESTADOS_FINALES as unknown as string[]);
    const sinLiquidarCandidatos = viajes.filter(
      (v) =>
        finales.has(v.estado) &&
        !!v.transportistaId &&
        (v.precioTransportistaExterno ?? 0) > 0,
    );
    const sinLiquidarItems: Array<{ id: string; numero: string; transportistaNombre: string | null }> = [];
    const montoPendiente = emptyMoney();
    const montoLiquidado = emptyMoney();
    let cantidadLiquidados = 0;
    const transportistaIds = new Set<string>();
    for (const v of sinLiquidarCandidatos) {
      const moneda = v.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS';
      const acordado = v.precioTransportistaExterno ?? 0;
      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
        : [];
      const pagado = pagos
        .filter((p) => (p.moneda === 'USD' ? 'USD' : 'ARS') === moneda)
        .reduce((s, p) => s + (typeof p.monto === 'number' ? p.monto : 0), 0);
      if (pagado >= acordado - 1e-6) {
        cantidadLiquidados += 1;
        addMoney(montoLiquidado, moneda, roundMoney(pagado));
        continue;
      }
      addMoney(montoPendiente, moneda, roundMoney(acordado - pagado));
      if (v.transportistaId) transportistaIds.add(v.transportistaId);
      sinLiquidarItems.push({ id: v.id, numero: v.numero ?? '', transportistaNombre: null });
    }
    const transportistas = transportistaIds.size
      ? await this.prisma.transportista.findMany({
          where: { id: { in: [...transportistaIds] }, tenantId },
          select: { id: true, nombre: true },
        })
      : [];
    const nombreTransportista = new Map(transportistas.map((t) => [t.id, t.nombre]));
    const sinLiquidarCandidatosPorId = new Map(sinLiquidarCandidatos.map((v) => [v.id, v]));
    for (const item of sinLiquidarItems) {
      const v = sinLiquidarCandidatosPorId.get(item.id);
      item.transportistaNombre = v?.transportistaId
        ? (nombreTransportista.get(v.transportistaId) ?? 'Transportista')
        : null;
    }

    const sinFacturarViajes = viajes.filter((v) => v.estado === 'finalizado_sin_facturar');
    const clienteIds = [...new Set(sinFacturarViajes.map((v) => v.clienteId))];
    const clientes = clienteIds.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: clienteIds }, tenantId },
          select: { id: true, nombre: true },
        })
      : [];
    const nombreCliente = new Map(clientes.map((c) => [c.id, c.nombre]));
    const sinFacturarDetalle = await this.prisma.viaje.findMany({
      where: { tenantId, id: { in: sinFacturarViajes.map((v) => v.id) } },
      select: { id: true, numero: true, monto: true, monedaMonto: true, clienteId: true },
    });
    const montoSinFacturar = emptyMoney();
    for (const v of sinFacturarDetalle) {
      addMoney(montoSinFacturar, v.monedaMonto === 'USD' ? 'USD' : 'ARS', v.monto ?? 0);
    }

    return {
      porEstado: [...porEstadoMap.entries()].map(([estado, cantidad]) => ({ estado, cantidad })),
      liquidados: {
        cantidad: cantidadLiquidados,
        montoTotal: montoLiquidado,
      },
      sinLiquidar: {
        cantidad: sinLiquidarItems.length,
        montoPendiente,
        items: sinLiquidarItems.slice(0, 30),
      },
      sinFacturar: {
        cantidad: sinFacturarDetalle.length,
        montoTotal: montoSinFacturar,
        items: sinFacturarDetalle.slice(0, 30).map((v) => ({
          id: v.id,
          numero: v.numero ?? '',
          clienteNombre: nombreCliente.get(v.clienteId) ?? 'Cliente',
        })),
      },
    };
  }

  // ── Liquidaciones a transportistas ──────────────────────────────────────

  private async buildLiquidaciones(
    tenantId: string,
    start: Date,
    end: Date,
    whereViajeAtribuido: (s: Date, e: Date) => Record<string, unknown>,
  ): Promise<NonNullable<FinancieroDashboardResponse['liquidaciones']>> {
    const viajes = await this.prisma.viaje.findMany({
      where: {
        tenantId,
        transportistaId: { not: null },
        precioTransportistaExterno: { gt: 0 },
        ...whereViajeAtribuido(start, end),
      },
      select: {
        transportistaId: true,
        precioTransportistaExterno: true,
        monedaPrecioTransportistaExterno: true,
        pagosTransportista: true,
      },
    });

    const porTransportistaMap = new Map<
      string,
      { acordado: Money; pagado: Money; cant: number }
    >();
    for (const v of viajes) {
      const tid = v.transportistaId as string;
      const moneda = v.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS';
      const acordado = v.precioTransportistaExterno ?? 0;
      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
        : [];
      const pagado = pagos
        .filter((p) => (p.moneda === 'USD' ? 'USD' : 'ARS') === moneda)
        .reduce((s, p) => s + (typeof p.monto === 'number' ? p.monto : 0), 0);
      const entry = porTransportistaMap.get(tid) ?? { acordado: emptyMoney(), pagado: emptyMoney(), cant: 0 };
      addMoney(entry.acordado, moneda, acordado);
      addMoney(entry.pagado, moneda, pagado);
      entry.cant += 1;
      porTransportistaMap.set(tid, entry);
    }

    const transportistaIds = [...porTransportistaMap.keys()];
    const transportistas = transportistaIds.length
      ? await this.prisma.transportista.findMany({
          where: { id: { in: transportistaIds }, tenantId },
          select: { id: true, nombre: true },
        })
      : [];
    const nombreTransportista = new Map(transportistas.map((t) => [t.id, t.nombre]));

    const aPagarPorTransportista = [...porTransportistaMap.entries()]
      .map(([transportistaId, v]) => ({
        transportistaId,
        nombre: nombreTransportista.get(transportistaId) ?? 'Transportista',
        acordado: v.acordado,
        pagado: v.pagado,
        pendiente: {
          ARS: roundMoney(v.acordado.ARS - v.pagado.ARS),
          USD: roundMoney(v.acordado.USD - v.pagado.USD),
        },
        cantViajes: v.cant,
      }))
      .sort((a, b) => b.pendiente.ARS + b.pendiente.USD - (a.pendiente.ARS + a.pendiente.USD));

    const liquidacionesRows = await this.prisma.liquidacion.findMany({
      where: {
        tenantId,
        estado: { not: 'anulado' },
        periodoDesde: { lte: end },
        periodoHasta: { gte: start },
      },
      select: {
        transportistaId: true,
        bruto: true,
        comision: true,
        gastosAdmin: true,
        liquido: true,
        periodoDesde: true,
      },
    });

    const porLiquidadoMap = new Map<string, { liquido: number; cant: number }>();
    const porPeriodoMap = new Map<
      string,
      { cant: number; bruto: number; comision: number; gastosAdmin: number; liquido: number }
    >();
    for (const l of liquidacionesRows) {
      const entry = porLiquidadoMap.get(l.transportistaId) ?? { liquido: 0, cant: 0 };
      entry.liquido = roundMoney(entry.liquido + l.liquido);
      entry.cant += 1;
      porLiquidadoMap.set(l.transportistaId, entry);

      const periodoKey = `${l.periodoDesde.getFullYear()}-${String(l.periodoDesde.getMonth() + 1).padStart(2, '0')}`;
      const p = porPeriodoMap.get(periodoKey) ?? { cant: 0, bruto: 0, comision: 0, gastosAdmin: 0, liquido: 0 };
      p.cant += 1;
      p.bruto = roundMoney(p.bruto + l.bruto);
      p.comision = roundMoney(p.comision + l.comision);
      p.gastosAdmin = roundMoney(p.gastosAdmin + l.gastosAdmin);
      p.liquido = roundMoney(p.liquido + l.liquido);
      porPeriodoMap.set(periodoKey, p);
    }

    const idsFaltantes = [...porLiquidadoMap.keys()].filter((id) => !nombreTransportista.has(id));
    const transportistasFaltantes = idsFaltantes.length
      ? await this.prisma.transportista.findMany({
          where: { id: { in: idsFaltantes }, tenantId },
          select: { id: true, nombre: true },
        })
      : [];
    for (const t of transportistasFaltantes) nombreTransportista.set(t.id, t.nombre);

    const rankingPorLiquidado = [...porLiquidadoMap.entries()]
      .map(([transportistaId, v]) => ({
        transportistaId,
        nombre: nombreTransportista.get(transportistaId) ?? 'Transportista',
        liquido: v.liquido,
        cantLiquidaciones: v.cant,
      }))
      .sort((a, b) => b.liquido - a.liquido)
      .slice(0, 20);

    const cvlpPorPeriodo = [...porPeriodoMap.entries()]
      .map(([periodo, v]) => ({ periodo, cantLiquidaciones: v.cant, bruto: v.bruto, comision: v.comision, gastosAdmin: v.gastosAdmin, liquido: v.liquido }))
      .sort((a, b) => a.periodo.localeCompare(b.periodo));

    return { aPagarPorTransportista: aPagarPorTransportista.slice(0, 20), rankingPorLiquidado, cvlpPorPeriodo };
  }

  // ── Facturación a cliente ────────────────────────────────────────────────

  private async buildFacturacion(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<NonNullable<FinancieroDashboardResponse['facturacion']>> {
    const facturas = await this.prisma.factura.findMany({
      where: { tenantId, tipo: 'cliente', fechaEmision: { gte: start, lte: end } },
      select: {
        id: true,
        numero: true,
        clienteId: true,
        importe: true,
        moneda: true,
        cbteTipo: true,
        fechaVencimiento: true,
        pagos: { select: { importe: true, fecha: true } },
        viajes: { select: { estado: true, monto: true } },
      },
    });

    const porTipoComprobante = {
      A: { cantidad: 0, monto: 0 },
      B: { cantidad: 0, monto: 0 },
      sinArca: { cantidad: 0, monto: 0 },
    };
    const facturadoTotal = emptyMoney();
    const cobradoTotal = emptyMoney();
    const porClienteMap = new Map<string, { facturado: Money; cobrado: Money; cant: number }>();

    for (const f of facturas) {
      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      const moneda = f.moneda === 'USD' ? 'USD' : 'ARS';
      addMoney(facturadoTotal, moneda, importeOp);

      if (f.cbteTipo === 1) {
        porTipoComprobante.A.cantidad += 1;
        porTipoComprobante.A.monto = roundMoney(porTipoComprobante.A.monto + importeOp);
      } else if (f.cbteTipo === 6) {
        porTipoComprobante.B.cantidad += 1;
        porTipoComprobante.B.monto = roundMoney(porTipoComprobante.B.monto + importeOp);
      } else {
        porTipoComprobante.sinArca.cantidad += 1;
        porTipoComprobante.sinArca.monto = roundMoney(porTipoComprobante.sinArca.monto + importeOp);
      }

      const pagadoEnPeriodo = f.pagos
        .filter((p) => p.fecha >= start && p.fecha <= end)
        .reduce((s, p) => s + p.importe, 0);
      addMoney(cobradoTotal, moneda, pagadoEnPeriodo);

      const entry = porClienteMap.get(f.clienteId) ?? { facturado: emptyMoney(), cobrado: emptyMoney(), cant: 0 };
      addMoney(entry.facturado, moneda, importeOp);
      addMoney(entry.cobrado, moneda, pagadoEnPeriodo);
      entry.cant += 1;
      porClienteMap.set(f.clienteId, entry);
    }

    const clienteIds = [...porClienteMap.keys()];
    const clientes = clienteIds.length
      ? await this.prisma.cliente.findMany({ where: { id: { in: clienteIds }, tenantId }, select: { id: true, nombre: true } })
      : [];
    const nombreCliente = new Map(clientes.map((c) => [c.id, c.nombre]));

    const rankingClientes = [...porClienteMap.entries()]
      .map(([clienteId, v]) => ({
        clienteId,
        nombre: nombreCliente.get(clienteId) ?? 'Cliente',
        facturado: v.facturado,
        cobrado: v.cobrado,
        pendienteCobro: {
          ARS: roundMoney(v.facturado.ARS - v.cobrado.ARS),
          USD: roundMoney(v.facturado.USD - v.cobrado.USD),
        },
        cantFacturas: v.cant,
      }))
      .sort((a, b) => b.facturado.ARS + b.facturado.USD - (a.facturado.ARS + a.facturado.USD))
      .slice(0, 20);

    const pendientesEmitir = await this.prisma.viaje.findMany({
      where: { tenantId, estado: 'finalizado_sin_facturar' },
      select: { id: true, numero: true, monto: true, monedaMonto: true, clienteId: true },
    });
    const clienteIdsPendientes = [...new Set(pendientesEmitir.map((v) => v.clienteId))];
    const clientesPendientes = clienteIdsPendientes.length
      ? await this.prisma.cliente.findMany({ where: { id: { in: clienteIdsPendientes }, tenantId }, select: { id: true, nombre: true } })
      : [];
    const nombreClientePendiente = new Map(clientesPendientes.map((c) => [c.id, c.nombre]));
    const montoPendienteEmitir = emptyMoney();
    for (const v of pendientesEmitir) addMoney(montoPendienteEmitir, v.monedaMonto === 'USD' ? 'USD' : 'ARS', v.monto ?? 0);

    // Facturado/cobrado global del período no se restringe a las facturas emitidas en el período
    // para "pendienteCobro": se recalcula sobre snapshot de facturas vencidas/pendientes reales.
    const facturasPendientesSnapshot = await this.prisma.factura.findMany({
      where: { tenantId, tipo: 'cliente' },
      select: {
        importe: true,
        moneda: true,
        pagos: { select: { importe: true } },
        viajes: { select: { estado: true, monto: true } },
      },
    });
    const pendienteCobroTotal = emptyMoney();
    for (const f of facturasPendientesSnapshot) {
      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      const pagado = f.pagos.reduce((s, p) => s + p.importe, 0);
      const pend = Math.max(0, roundMoney(importeOp - pagado));
      if (pend > 0) addMoney(pendienteCobroTotal, f.moneda === 'USD' ? 'USD' : 'ARS', pend);
    }

    return {
      porTipoComprobante,
      rankingClientes,
      pendientesEmitir: {
        cantidad: pendientesEmitir.length,
        montoTotal: montoPendienteEmitir,
        items: pendientesEmitir.slice(0, 30).map((v) => ({
          id: v.id,
          numero: v.numero ?? '',
          clienteNombre: nombreClientePendiente.get(v.clienteId) ?? 'Cliente',
        })),
      },
      facturadoVsCobrado: {
        facturado: facturadoTotal,
        cobrado: cobradoTotal,
        pendienteCobro: pendienteCobroTotal,
      },
    };
  }

  // ── Cashflow cruzado ─────────────────────────────────────────────────────

  private async buildCashflow(tenantId: string): Promise<NonNullable<FinancieroDashboardResponse['cashflow']>> {
    const hoy = new Date();
    const facturasPendientes = await this.prisma.factura.findMany({
      where: { tenantId, tipo: 'cliente' },
      select: {
        importe: true,
        moneda: true,
        fechaVencimiento: true,
        fechaEmision: true,
        pagos: { select: { importe: true, fecha: true } },
        viajes: { select: { estado: true, monto: true } },
      },
    });

    const buckets: Array<{ bucket: string; monto: Money }> = [
      { bucket: 'Vencido', monto: emptyMoney() },
      { bucket: '0-7 días', monto: emptyMoney() },
      { bucket: '8-15 días', monto: emptyMoney() },
      { bucket: '16-30 días', monto: emptyMoney() },
      { bucket: '31+ días', monto: emptyMoney() },
      { bucket: 'Sin vencimiento', monto: emptyMoney() },
    ];
    let sumaDiasCobro = 0;
    let cantDiasCobro = 0;

    for (const f of facturasPendientes) {
      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      const pagado = f.pagos.reduce((s, p) => s + p.importe, 0);
      const pend = roundMoney(importeOp - pagado);
      const moneda = f.moneda === 'USD' ? 'USD' : 'ARS';

      if (pend > 0.005) {
        if (!f.fechaVencimiento) {
          addMoney(buckets[5].monto, moneda, pend);
        } else {
          const dias = Math.floor((f.fechaVencimiento.getTime() - hoy.getTime()) / 86400000);
          if (dias < 0) addMoney(buckets[0].monto, moneda, pend);
          else if (dias <= 7) addMoney(buckets[1].monto, moneda, pend);
          else if (dias <= 15) addMoney(buckets[2].monto, moneda, pend);
          else if (dias <= 30) addMoney(buckets[3].monto, moneda, pend);
          else addMoney(buckets[4].monto, moneda, pend);
        }
      }

      for (const p of f.pagos) {
        const dias = Math.floor((p.fecha.getTime() - f.fechaEmision.getTime()) / 86400000);
        if (Number.isFinite(dias) && dias >= 0) {
          sumaDiasCobro += dias;
          cantDiasCobro += 1;
        }
      }
    }

    const viajesConPagos = await this.prisma.viaje.findMany({
      where: { tenantId, transportistaId: { not: null }, precioTransportistaExterno: { gt: 0 } },
      select: {
        precioTransportistaExterno: true,
        monedaPrecioTransportistaExterno: true,
        pagosTransportista: true,
        fechaFinalizado: true,
      },
    });

    const aPagarPendienteTotal = emptyMoney();
    let sumaDiasPago = 0;
    let cantDiasPago = 0;
    for (const v of viajesConPagos) {
      const moneda = v.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS';
      const acordado = v.precioTransportistaExterno ?? 0;
      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string; fecha?: string }>)
        : [];
      const pagosEnMoneda = pagos.filter((p) => (p.moneda === 'USD' ? 'USD' : 'ARS') === moneda);
      const pagado = pagosEnMoneda.reduce((s, p) => s + (typeof p.monto === 'number' ? p.monto : 0), 0);
      const pend = roundMoney(acordado - pagado);
      if (pend > 0.005) addMoney(aPagarPendienteTotal, moneda, pend);

      if (v.fechaFinalizado) {
        for (const p of pagosEnMoneda) {
          if (!p.fecha) continue;
          const fechaPago = new Date(p.fecha);
          const dias = Math.floor((fechaPago.getTime() - v.fechaFinalizado.getTime()) / 86400000);
          if (Number.isFinite(dias) && dias >= 0) {
            sumaDiasPago += dias;
            cantDiasPago += 1;
          }
        }
      }
    }

    const promedioDiasCobro = cantDiasCobro > 0 ? Math.round(sumaDiasCobro / cantDiasCobro) : null;
    const promedioDiasPago = cantDiasPago > 0 ? Math.round(sumaDiasPago / cantDiasPago) : null;
    const alerta =
      promedioDiasCobro != null && promedioDiasPago != null && promedioDiasPago < promedioDiasCobro;

    return {
      aCobrarProyeccion: buckets,
      aPagarPendienteTotal,
      diferenciaTiming: { promedioDiasCobro, promedioDiasPago, alerta },
    };
  }
}
