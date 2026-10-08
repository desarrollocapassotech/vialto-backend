import { Injectable, OnModuleInit } from '@nestjs/common';
import { NotificacionesCronService } from '../../notificaciones/notificaciones-cron.service';
import type {
  NotificacionEvaluator,
  NotificacionItem,
} from '../../notificaciones/evaluators/notificacion-evaluator.interface';
import { VencimientosService } from '../vencimientos.service';
import { armarAvisosVencimiento } from '../vencimientos-avisos.util';

/**
 * Avisos de mantenimiento (MANT-03). Viven en este módulo y se registran en
 * `NotificacionesCronService` al arrancar, así `notificaciones` no depende de Mantenimiento y
 * el aviso sale del mismo cálculo que la pantalla de vencimientos (`VencimientosService`).
 */
@Injectable()
export class VencimientoProximoEvaluator implements NotificacionEvaluator, OnModuleInit {
  readonly tipo = 'mantenimiento.vencimientoProximo';

  constructor(
    private readonly vencimientos: VencimientosService,
    private readonly cron: NotificacionesCronService,
  ) {}

  onModuleInit() {
    this.cron.registrarEvaluator(this);
  }

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    return armarAvisosVencimiento(await this.vencimientos.calcular(tenantId, { estado: 'proximo' }), 'proximo');
  }
}

@Injectable()
export class VencidoEvaluator implements NotificacionEvaluator, OnModuleInit {
  readonly tipo = 'mantenimiento.vencido';

  constructor(
    private readonly vencimientos: VencimientosService,
    private readonly cron: NotificacionesCronService,
  ) {}

  onModuleInit() {
    this.cron.registrarEvaluator(this);
  }

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    return armarAvisosVencimiento(await this.vencimientos.calcular(tenantId, { estado: 'vencido' }), 'vencido');
  }
}
