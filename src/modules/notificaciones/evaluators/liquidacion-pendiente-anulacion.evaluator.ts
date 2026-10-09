import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type { NotificacionEvaluator, NotificacionItem } from './notificacion-evaluator.interface';

/** Semana ISO (`2026-W41`) — se suma al `entidadId` para que el aviso se repita cada semana. */
export function semanaIso(fecha: Date): string {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

function fmtFecha(d: Date): string {
  return d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

/**
 * Liquidaciones marcadas "pendiente de anulación" (anulación manual) que todavía no se
 * confirmaron como anuladas. Es un recordatorio: el `entidadId` lleva la semana, así que
 * mientras siga pendiente se vuelve a avisar en cada corrida semanal (no una sola vez).
 */
@Injectable()
export class LiquidacionPendienteAnulacionEvaluator implements NotificacionEvaluator {
  readonly tipo = 'liquidaciones.pendienteAnulacion';

  constructor(private readonly prisma: PrismaService) {}

  async evaluar(tenantId: string, ahora = new Date()): Promise<NotificacionItem[]> {
    const liquidaciones = await this.prisma.liquidacion.findMany({
      where: { tenantId, estado: 'pendiente_anulacion' },
      select: {
        id: true,
        ptoVenta: true,
        cbteNro: true,
        liquido: true,
        anulacionPendienteDesde: true,
        transportista: { select: { nombre: true } },
      },
      orderBy: { anulacionPendienteDesde: 'asc' },
    });
    const semana = semanaIso(ahora);

    return liquidaciones.map((l) => {
      const numero =
        l.ptoVenta != null && l.cbteNro != null
          ? `${String(l.ptoVenta).padStart(5, '0')}-${String(l.cbteNro).padStart(8, '0')}`
          : 'sin número';
      const desde = l.anulacionPendienteDesde
        ? `Pendiente de anular desde el ${fmtFecha(l.anulacionPendienteDesde)}`
        : 'Pendiente de anular';
      return {
        entidadId: `${l.id}:${semana}`,
        titulo: `Liquidación ${numero} — ${l.transportista?.nombre ?? 'transportista'}`,
        detalle: `${desde} · Líquido $${l.liquido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      };
    });
  }
}
