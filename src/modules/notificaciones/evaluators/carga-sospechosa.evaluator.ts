import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type { NotificacionEvaluator, NotificacionItem } from './notificacion-evaluator.interface';

/** Ventana de búsqueda hacia atrás — acotada para que la query sea liviana; el dedup por `entidadId` en `NotificacionEnvio` evita reenviar. */
const DIAS_VENTANA = 2;

const MOTIVO_LABEL: Record<string, string> = {
  litros_extremo: 'litros fuera de rango',
  importe_invalido: 'importe inválido',
  precio_litro_fuera_de_rango: 'precio por litro fuera de rango',
  km_delta_invalido: 'salto de kilometraje inválido',
};

/** Cargas de combustible marcadas `sospechoso` en los últimos días — el dedup de `NotificacionEnvio` asegura que cada carga se avise una sola vez. */
@Injectable()
export class CargaSospechosaEvaluator implements NotificacionEvaluator {
  readonly tipo = 'combustible.cargaSospechosa';

  constructor(private readonly prisma: PrismaService) {}

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    const desde = new Date();
    desde.setDate(desde.getDate() - DIAS_VENTANA);
    desde.setHours(0, 0, 0, 0);

    const cargas = await this.prisma.cargaCombustible.findMany({
      where: { tenantId, sospechoso: true, fecha: { gte: desde } },
      select: {
        id: true,
        estacion: true,
        litros: true,
        importe: true,
        fecha: true,
        motivoSospecha: true,
        vehiculoId: true,
      },
      orderBy: { fecha: 'desc' },
    });
    if (cargas.length === 0) return [];

    const vehiculoIds = [...new Set(cargas.map((c) => c.vehiculoId).filter((id): id is string => !!id))];
    const vehiculos = vehiculoIds.length
      ? await this.prisma.vehiculo.findMany({
          where: { id: { in: vehiculoIds }, tenantId },
          select: { id: true, patente: true },
        })
      : [];
    const patenteVehiculo = new Map(vehiculos.map((v) => [v.id, v.patente]));

    return cargas.map((c) => ({
      entidadId: c.id,
      titulo: `Carga sospechosa — ${c.vehiculoId ? (patenteVehiculo.get(c.vehiculoId) ?? 'vehículo') : 'vehículo sin datos'} en ${c.estacion}`,
      detalle: `${c.fecha.toLocaleDateString('es-AR')} · ${c.litros} L · $${c.importe.toLocaleString('es-AR')} · Motivo: ${MOTIVO_LABEL[c.motivoSospecha ?? ''] ?? c.motivoSospecha ?? 'sin especificar'}`,
    }));
  }
}
