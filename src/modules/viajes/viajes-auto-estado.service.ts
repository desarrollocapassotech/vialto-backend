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

    const condicionMontoCliente = {
      OR: [
        { monto: { gt: 0 } },
        {
          AND: [
            { cantidadFactura: { gt: 0 } },
            { precioUnitarioFactura: { gt: 0 } },
          ],
        },
      ],
    };

    const condicionMontoTransportista = {
      OR: [
        { transportistaId: null },
        { precioTransportistaExterno: { gt: 0 } },
        {
          AND: [
            { cantidadTransportista: { gt: 0 } },
            { precioUnitarioTransportista: { gt: 0 } },
          ],
        },
      ],
    };

    const [finalizados, enCurso] = await Promise.all([
      // pendiente/en_curso + fechaDescarga <= ahora + montos completos → finalizado
      this.prisma.viaje.updateMany({
        where: {
          ...base,
          etapa: { in: ['pendiente', 'en_curso'] },
          fechaDescarga: { lte: ahora },
          AND: [condicionMontoCliente, condicionMontoTransportista],
        },
        data: { etapa: 'finalizado', fechaFinalizado: new Date() },
      }),

      // pendiente + (fechaCarga <= ahora OR fechaDescarga <= ahora) que no pasaron a finalizado → en_curso
      this.prisma.viaje.updateMany({
        where: {
          ...base,
          etapa: 'pendiente',
          OR: [
            { fechaCarga: { lte: ahora } },
            { fechaDescarga: { lte: ahora } },
          ],
        },
        data: { etapa: 'en_curso' },
      }),
    ]);

    const total = finalizados.count + enCurso.count;
    if (total > 0) {
      this.logger.log(
        `Auto-etapa${tenantId ? ` [${tenantId}]` : ''}: ` +
        `${enCurso.count} → en_curso, ${finalizados.count} → finalizado`,
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
