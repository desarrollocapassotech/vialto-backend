import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  DashboardAlertasRegistry,
  type ProveedorBloqueAlerta,
} from '../../dashboard/dashboard-alertas.registry';
import { VencimientosService } from '../vencimientos.service';

/**
 * Bloque de Mantenimiento en el "Resumen de alertas" del dashboard (MANT-03-T3): vencidos +
 * próximos (los "sin datos" no cuentan — decisión de Elias). Se registra en el dashboard al
 * arrancar, así `dashboard` no depende de Mantenimiento y el número sale del mismo cálculo
 * que el semáforo y los mails.
 */
@Injectable()
export class VencimientosAlertaProveedor implements ProveedorBloqueAlerta, OnModuleInit {
  readonly clave = 'mantenimiento' as const;
  readonly requiereModulo = 'mantenimiento';

  constructor(
    private readonly vencimientos: VencimientosService,
    private readonly registry: DashboardAlertasRegistry,
  ) {}

  onModuleInit() {
    this.registry.registrar(this);
  }

  async obtener(tenantId: string) {
    const r = await this.vencimientos.resumen(tenantId);
    return { cantidad: r.vencido + r.proximo, vencidos: r.vencido, proximos: r.proximo };
  }
}
