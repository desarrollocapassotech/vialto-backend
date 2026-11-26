import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  cobroOptsDeFactura,
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from '../../../shared/util/factura-estado-lectura';
import { fechaCalendarioAr } from '../../../shared/util/fecha-ar.util';
import type { NotificacionEvaluator, NotificacionItem } from './notificacion-evaluator.interface';

/** Cuántos días hacia adelante se considera "por vencer". */
export const DIAS_AVISO_POR_VENCER = 3;
/**
 * Ventana hacia atrás para "vencidos". Cada vencimiento se avisa una sola vez (dedup por
 * `NotificacionEnvio`), normalmente al día siguiente de vencer; la ventana solo cubre días sin cron
 * (caída, deploy) y evita que la primera corrida mande todo el histórico de un tenant.
 */
export const DIAS_VENTANA_VENCIDOS = 30;

const DIA_MS = 86_400_000;

export const SECCION_VENCIDOS = 'Vencidos';
export const SECCION_POR_VENCER = 'Vencen pronto';

/** Un vencimiento con saldo, venga de una factura o de un movimiento de cuenta corriente. */
export type VencimientoConSaldo = {
  /** id del registro (factura o movimiento de CC) — base del `entidadId`. */
  id: string;
  contraparte: string;
  sentido: 'cobrar' | 'pagar';
  /** Tipo + número del comprobante, ej. "FACTURA A 0003-00000094". */
  comprobante: string | null;
  /** Medianoche UTC del día de vencimiento (convención de `fechaVencimiento`). */
  fechaVencimiento: Date;
  saldo: number;
  moneda: string;
  url: string;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const fmtFecha = (d: Date) =>
  d.toLocaleDateString('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

export function fmtImporte(monto: number, moneda: string): string {
  return `${moneda} ${monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Venció ayer", "Venció hace 4 días", "Vence hoy", "Vence mañana", "Vence en 3 días". */
export function etiquetaVencimiento(dias: number): string {
  if (dias < 0) {
    const hace = -dias;
    return hace === 1 ? 'Venció ayer' : `Venció hace ${hace} días`;
  }
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
}

/**
 * Arma los avisos: vencidos primero (el más viejo arriba), después los que vencen pronto (el más
 * cercano arriba). `entidadId = id:vencido | id:por-vencer`, así un mismo vencimiento se avisa
 * una vez al acercarse y otra vez si vence sin saldarse.
 */
export function armarAvisosVencimientos(lista: VencimientoConSaldo[], hoy: Date): NotificacionItem[] {
  return lista
    .map((v) => ({ v, dias: Math.round((v.fechaVencimiento.getTime() - hoy.getTime()) / DIA_MS) }))
    .sort((a, b) => {
      const va = a.dias < 0 ? 0 : 1;
      const vb = b.dias < 0 ? 0 : 1;
      return va - vb || a.dias - b.dias || a.v.contraparte.localeCompare(b.v.contraparte, 'es');
    })
    .map(({ v, dias }) => {
      const vencido = dias < 0;
      const lado = v.sentido === 'cobrar' ? 'A cobrar' : 'A pagar';
      const etiqueta = etiquetaVencimiento(dias);
      const subtitulo = [lado, v.comprobante].filter(Boolean).join(' · ');
      return {
        entidadId: `${v.id}:${vencido ? 'vencido' : 'por-vencer'}`,
        titulo: `${lado}: ${v.contraparte}${v.comprobante ? ` — ${v.comprobante}` : ''}`,
        detalle: `${etiqueta} (${fmtFecha(v.fechaVencimiento)}) · Saldo ${fmtImporte(v.saldo, v.moneda)}`,
        url: v.url,
        seccion: vencido ? SECCION_VENCIDOS : SECCION_POR_VENCER,
        tono: vencido ? 'alerta' : 'aviso',
        subtitulo,
        etiqueta: `${etiqueta} · ${fmtFecha(v.fechaVencimiento)}`,
        importe: { monto: v.saldo, moneda: v.moneda, sentido: v.sentido },
      } satisfies NotificacionItem;
    });
}

/**
 * Vencimientos de cobros y pagos (un solo tipo de aviso, nov 2026). Con Cuenta corriente la fuente
 * es la cuenta corriente (ventas y compras con saldo: incluye las facturas de cliente, que nacen ahí
 * como venta, y las liquidaciones y compras a pagar). Sin Cuenta corriente, las facturas de cliente.
 * Nunca las dos a la vez: era lo que mandaba dos mails por la misma factura.
 */
@Injectable()
export class VencimientosEvaluator implements NotificacionEvaluator {
  readonly tipo = 'vencimientos';

  constructor(private readonly prisma: PrismaService) {}

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    const modules = tenant?.modules ?? [];

    // Hoy en Argentina a medianoche UTC, igual que `fechaVencimiento` (no el día del server en UTC).
    const hoy = fechaCalendarioAr();
    const desde = new Date(hoy.getTime() - DIAS_VENTANA_VENCIDOS * DIA_MS);
    const hasta = new Date(hoy.getTime() + DIAS_AVISO_POR_VENCER * DIA_MS);

    const lista = modules.includes('cuenta-corriente')
      ? await this.desdeCuentaCorriente(tenantId, desde, hasta)
      : modules.includes('facturacion')
        ? await this.desdeFacturas(tenantId, modules, desde, hasta)
        : [];
    return armarAvisosVencimientos(lista, hoy);
  }

  /** Ventas (a cobrar) y compras (a pagar) de cuenta corriente con saldo, sin anular. */
  private async desdeCuentaCorriente(tenantId: string, desde: Date, hasta: Date): Promise<VencimientoConSaldo[]> {
    const cargos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: {
        tenantId,
        tipo: 'cargo',
        estadoDisponibilidad: { in: ['pendiente', 'parcial'] },
        fechaVencimiento: { gte: desde, lte: hasta },
      },
      select: {
        id: true,
        clienteId: true,
        contraparteId: true,
        concepto: true,
        numeroComprobante: true,
        importe: true,
        moneda: true,
        fechaVencimiento: true,
        cliente: { select: { nombre: true } },
        proveedor: { select: { nombre: true } },
        imputacionesComoCargo: { select: { importe: true } },
      },
    });

    const lista: VencimientoConSaldo[] = [];
    for (const c of cargos) {
      const imputado = c.imputacionesComoCargo.reduce((s, i) => s + i.importe, 0);
      const saldo = roundMoney(c.importe - imputado);
      if (saldo <= 0 || !c.fechaVencimiento) continue;
      const esCliente = !!c.clienteId;
      const comprobante = [c.concepto, c.numeroComprobante].filter(Boolean).join(' ').trim();
      lista.push({
        id: c.id,
        contraparte: c.cliente?.nombre ?? c.proveedor?.nombre ?? (esCliente ? 'Cliente' : 'Proveedor'),
        sentido: esCliente ? 'cobrar' : 'pagar',
        comprobante: comprobante || null,
        fechaVencimiento: c.fechaVencimiento,
        saldo,
        moneda: c.moneda,
        url: `/cuenta-corriente?tipo=${esCliente ? 'cliente' : 'proveedor'}&id=${encodeURIComponent(c.contraparteId)}`,
      });
    }
    return lista;
  }

  /** Facturas de cliente con saldo, sin cobrar ni anular (empresas sin Cuenta corriente). */
  private async desdeFacturas(
    tenantId: string,
    modules: string[],
    desde: Date,
    hasta: Date,
  ): Promise<VencimientoConSaldo[]> {
    const tieneArca = modules.includes('emision-facturas-arca');
    const facturas = await this.prisma.factura.findMany({
      where: {
        tenantId,
        tipo: 'cliente',
        fechaVencimiento: { gte: desde, lte: hasta },
      },
      select: {
        id: true,
        numero: true,
        importe: true,
        moneda: true,
        fechaVencimiento: true,
        arcaEstado: true,
        manual: true,
        facturarPorTramo: true,
        ivaPct: true,
        ivaMonto: true,
        conceptos: true,
        clienteId: true,
        pagos: { select: { importe: true } },
        viajes: { select: { id: true, facturacionEstado: true, monto: true } },
        tramos: { select: { viajeId: true, monto: true, ivaPct: true } },
      },
    });
    if (facturas.length === 0) return [];

    const clienteIds = [...new Set(facturas.map((f) => f.clienteId).filter((id): id is string => !!id))];
    const clientes = clienteIds.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: clienteIds }, tenantId },
          select: { id: true, nombre: true },
        })
      : [];
    const nombreCliente = new Map(clientes.map((c) => [c.id, c.nombre]));

    const lista: VencimientoConSaldo[] = [];
    for (const f of facturas) {
      if (!f.fechaVencimiento) continue;
      const opts = cobroOptsDeFactura(f, tieneArca);
      const estado = computeEstadoFacturaLectura({
        viajes: f.viajes,
        fechaVencimiento: f.fechaVencimiento,
        importeGuardado: f.importe,
        pagos: f.pagos,
        arcaEstado: f.arcaEstado,
        tieneArca,
        manual: f.manual,
        facturarPorTramo: opts.facturarPorTramo,
        tramos: f.tramos,
        ivaPctCabecera: f.ivaPct,
        ivaMontoGuardado: opts.ivaMontoGuardado,
        conceptos: f.conceptos,
      });
      if (estado.cobrado || estado.estado === 'anulado') continue;

      const importeOp = importeOperativoFactura(f.importe, f.viajes, opts);
      const pagado = f.pagos.reduce((s, p) => s + p.importe, 0);
      const saldo = roundMoney(importeOp - pagado);
      if (saldo <= 0) continue;

      lista.push({
        id: f.id,
        contraparte: nombreCliente.get(f.clienteId ?? '') ?? 'Cliente',
        sentido: 'cobrar',
        comprobante: `Factura ${f.numero || 'sin número'}`,
        fechaVencimiento: f.fechaVencimiento,
        saldo,
        moneda: f.moneda,
        url: `/facturacion?factura=${encodeURIComponent(f.id)}`,
      });
    }
    return lista;
  }
}
