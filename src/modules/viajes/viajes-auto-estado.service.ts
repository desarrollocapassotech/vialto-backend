import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class ViajesAutoEstadoService {
  private readonly logger = new Logger(ViajesAutoEstadoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Actualiza estados de viajes según fechas de carga y descarga.
   * Solo afecta viajes en estado 'pendiente' o 'en_curso'.
   *
   * Si se pasa `tenantId`, solo actualiza ese tenant (lazy update al listar).
   * Sin `tenantId`, actualiza todos los tenants (cron nocturno).
   */
  async actualizarEstadosPorFecha(tenantId?: string): Promise<void> {
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);

    const base = tenantId ? { tenantId } : {};

    const [finalizados, facturados, enCurso] = await Promise.all([
      // pendiente/en_curso + fechaDescarga <= hoy + sin nroFactura → finalizado_sin_facturar
      this.prisma.viaje.updateMany({
        where: {
          ...base,
          estado: { in: ['pendiente', 'en_curso'] },
          fechaDescarga: { lte: hoy },
          nroFactura: null,
        },
        data: { estado: 'finalizado_sin_facturar', fechaFinalizado: new Date() },
      }),

      // pendiente/en_curso + fechaDescarga <= hoy + con nroFactura → facturado_sin_cobrar
      this.prisma.viaje.updateMany({
        where: {
          ...base,
          estado: { in: ['pendiente', 'en_curso'] },
          fechaDescarga: { lte: hoy },
          nroFactura: { not: null },
        },
        data: { estado: 'facturado_sin_cobrar', fechaFinalizado: new Date() },
      }),

      // pendiente + fechaCarga <= hoy + fechaDescarga no pasada → en_curso
      this.prisma.viaje.updateMany({
        where: {
          ...base,
          estado: 'pendiente',
          fechaCarga: { lte: hoy },
          OR: [{ fechaDescarga: null }, { fechaDescarga: { gt: hoy } }],
        },
        data: { estado: 'en_curso' },
      }),
    ]);

    const total = finalizados.count + facturados.count + enCurso.count;
    if (total > 0) {
      this.logger.log(
        `Auto-estado${tenantId ? ` [${tenantId}]` : ''}: ` +
        `${enCurso.count} → en_curso, ${finalizados.count} → finalizado_sin_facturar, ` +
        `${facturados.count} → facturado_sin_cobrar`,
      );
    }
  }

  /** Cron diario a medianoche (hora Argentina, UTC-3). */
  @Cron('0 3 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronNocturno(): Promise<void> {
    this.logger.log('Ejecutando cron de auto-estado de viajes...');
    await this.actualizarEstadosPorFecha();
  }
}
