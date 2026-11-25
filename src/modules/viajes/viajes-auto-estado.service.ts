import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class ViajesAutoEstadoService {
  private readonly logger = new Logger(ViajesAutoEstadoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Actualiza `etapa` según fechas de carga y descarga. Facturación y liquidación
   * ya no dependen de la etapa — se sincronizan por su cuenta desde los
   * comprobantes (ver `viaje-estado-financiero.ts`).
   *
   * Si se pasa `tenantId`, solo actualiza ese tenant (lazy update al listar).
   * Sin `tenantId`, actualiza todos los tenants (cron nocturno).
   */
  async actualizarEstadosPorFecha(tenantId?: string): Promise<void> {
    const ahora = new Date();

    const base = tenantId ? { tenantId } : {};

    // pendiente + (fechaCarga <= ahora OR fechaDescarga <= ahora) → en_curso
    // La etapa 'finalizado' ya no se asigna automáticamente por fechas; el viaje
    // pasa a finalizado cuando queda valorizado o por acción manual (ver viajes.service.ts).
    const enCurso = await this.prisma.viaje.updateMany({
      where: {
        ...base,
        etapa: 'pendiente',
        OR: [
          { fechaCarga: { lte: ahora } },
          { fechaDescarga: { lte: ahora } },
        ],
      },
      data: { etapa: 'en_curso' },
    });

    if (enCurso.count > 0) {
      this.logger.log(
        `Auto-etapa${tenantId ? ` [${tenantId}]` : ''}: ${enCurso.count} → en_curso`,
      );
    }
  }

  /** Cron diario a medianoche (hora Argentina, UTC-3). */
  @Cron('0 3 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronNocturno(): Promise<void> {
    this.logger.log('Ejecutando cron de auto-etapa de viajes...');
    await this.actualizarEstadosPorFecha();
  }
}
