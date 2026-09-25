import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type { NotificacionEvaluator, NotificacionItem } from './notificacion-evaluator.interface';

/** Cuántos días hacia adelante se considera "por vencer" — mismo criterio que facturaPorVencer. */
const DIAS_AVISO_VENCIMIENTO = 3;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cargos de Cuenta Corriente (ventas a cliente o compras a proveedor) que vencen en los
 * próximos `DIAS_AVISO_VENCIMIENTO` días, con saldo pendiente y sin anular. Cubre las dos
 * caras del módulo (a cobrar y a pagar) en un único tipo de notificación — igual que el
 * tablero las muestra juntas.
 */
@Injectable()
export class CuentaCorrienteVencimientoEvaluator implements NotificacionEvaluator {
  readonly tipo = 'cuenta-corriente.vencimiento';

  constructor(private readonly prisma: PrismaService) {}

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + DIAS_AVISO_VENCIMIENTO);

    const cargos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: {
        tenantId,
        tipo: 'cargo',
        estadoDisponibilidad: { in: ['pendiente', 'parcial'] },
        fechaVencimiento: { gte: hoy, lte: limite },
      },
      include: {
        cliente: { select: { nombre: true } },
        proveedor: { select: { nombre: true } },
        imputacionesComoCargo: { select: { importe: true } },
      },
    });
    if (cargos.length === 0) return [];

    const items: NotificacionItem[] = [];
    for (const c of cargos) {
      const imputado = c.imputacionesComoCargo.reduce((s, i) => s + i.importe, 0);
      const pendiente = roundMoney(c.importe - imputado);
      if (pendiente <= 0) continue;

      const esCliente = !!c.clienteId;
      const nombre = c.cliente?.nombre ?? c.proveedor?.nombre ?? 'Contraparte';
      items.push({
        entidadId: c.id,
        titulo: `${esCliente ? 'A cobrar' : 'A pagar'}: ${nombre}`,
        detalle: `Vence el ${c.fechaVencimiento!.toLocaleDateString('es-AR')} · Saldo ${c.moneda} ${pendiente.toLocaleString('es-AR')}`,
      });
    }
    return items;
  }
}
