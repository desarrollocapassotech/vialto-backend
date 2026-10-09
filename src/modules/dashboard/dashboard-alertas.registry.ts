import { Injectable } from '@nestjs/common';

/**
 * Claves de bloques del "Resumen de alertas" que aportan módulos vendibles. Son contrato de
 * datos con el frontend (`OwnerDashboardResponse['alertas'][clave]`), igual que los tipos del
 * catálogo de notificaciones: el dashboard las conoce, pero no importa código del módulo.
 */
export type ClaveBloqueAlerta = 'mantenimiento';

export interface ProveedorBloqueAlerta {
  clave: ClaveBloqueAlerta;
  /** Slug de `Tenant.modules`: si el tenant no lo tiene, el bloque ni se calcula. */
  requiereModulo: string;
  /** Snapshot actual (no depende del período del selector). `cantidad = 0` → no se muestra. */
  obtener(tenantId: string): Promise<{ cantidad: number } & Record<string, unknown>>;
}

/**
 * Punto de extensión para que un módulo vendible sume su bloque al "Resumen de alertas" sin que
 * `dashboard` dependa de él (mismo patrón que `NotificacionesCronService.registrarEvaluator`):
 * el módulo registra su proveedor en `onModuleInit`. Una clave repetida falla el arranque.
 */
@Injectable()
export class DashboardAlertasRegistry {
  private readonly lista: ProveedorBloqueAlerta[] = [];

  registrar(proveedor: ProveedorBloqueAlerta): void {
    if (this.lista.some((p) => p.clave === proveedor.clave)) {
      throw new Error(`DashboardAlertasRegistry: ya hay un proveedor para "${proveedor.clave}"`);
    }
    this.lista.push(proveedor);
  }

  proveedores(): readonly ProveedorBloqueAlerta[] {
    return this.lista;
  }
}
