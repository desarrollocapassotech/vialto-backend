import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { evaluarFacturasConSaldo } from './factura-por-vencer.evaluator';
import type { NotificacionEvaluator, NotificacionItem } from './notificacion-evaluator.interface';

/**
 * Ventana hacia atrás. Cada factura se avisa una sola vez (dedup por `NotificacionEnvio`),
 * normalmente al día siguiente de vencer; la ventana solo cubre días sin cron (caída,
 * deploy) y evita que la primera corrida mande todo el histórico de vencidas de un tenant.
 */
const DIAS_VENTANA_VENCIDAS = 30;

/** Facturas de cliente que ya vencieron (en los últimos `DIAS_VENTANA_VENCIDAS` días) y siguen con saldo, sin anular. */
@Injectable()
export class FacturaVencidaEvaluator implements NotificacionEvaluator {
  readonly tipo = 'facturacion.facturaVencida';

  constructor(private readonly prisma: PrismaService) {}

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ayerFin = new Date(hoy.getTime() - 1);
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - DIAS_VENTANA_VENCIDAS);

    return evaluarFacturasConSaldo(
      this.prisma,
      tenantId,
      { desde, hasta: ayerFin },
      (vto, saldo) => `Venció el ${vto.toLocaleDateString('es-AR')} y no fue cobrada · ${saldo}`,
    );
  }
}
