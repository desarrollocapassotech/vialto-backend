import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from '../../../shared/util/factura-estado-lectura';
import type { NotificacionEvaluator, NotificacionItem } from './notificacion-evaluator.interface';

/** Cuántos días hacia adelante se considera "por vencer". */
const DIAS_AVISO_VENCIMIENTO = 3;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Facturas de cliente que vencen en los próximos `DIAS_AVISO_VENCIMIENTO` días, con saldo pendiente y sin anular. */
@Injectable()
export class FacturaPorVencerEvaluator implements NotificacionEvaluator {
  readonly tipo = 'facturacion.facturaPorVencer';

  constructor(private readonly prisma: PrismaService) {}

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + DIAS_AVISO_VENCIMIENTO);

    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    const tieneArca = tenant?.modules.includes('integracion-arca') ?? false;

    const facturas = await this.prisma.factura.findMany({
      where: {
        tenantId,
        tipo: 'cliente',
        fechaVencimiento: { gte: hoy, lte: limite },
      },
      select: {
        id: true,
        numero: true,
        importe: true,
        moneda: true,
        fechaVencimiento: true,
        arcaEstado: true,
        clienteId: true,
        pagos: { select: { importe: true } },
        viajes: { select: { facturacionEstado: true, monto: true } },
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

    const items: NotificacionItem[] = [];
    for (const f of facturas) {
      const estado = computeEstadoFacturaLectura({
        viajes: f.viajes,
        fechaVencimiento: f.fechaVencimiento,
        importeGuardado: f.importe,
        pagos: f.pagos,
        arcaEstado: f.arcaEstado,
        tieneArca,
      });
      if (estado.cobrado || estado.estado === 'anulado') continue;

      const importeOp = importeOperativoFactura(f.importe, f.viajes);
      const pagado = f.pagos.reduce((s, p) => s + p.importe, 0);
      const saldo = roundMoney(importeOp - pagado);
      if (saldo <= 0) continue;

      items.push({
        entidadId: f.id,
        titulo: `Factura ${f.numero} — ${nombreCliente.get(f.clienteId ?? '') ?? 'Cliente'}`,
        detalle: `Vence el ${f.fechaVencimiento!.toLocaleDateString('es-AR')} · Saldo ${f.moneda} ${saldo.toLocaleString('es-AR')}`,
      });
    }
    return items;
  }
}
