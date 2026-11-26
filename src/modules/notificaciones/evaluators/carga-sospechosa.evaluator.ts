import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type { NotificacionEvaluator, NotificacionItem } from './notificacion-evaluator.interface';

/**
 * Tope de filas por corrida — protege la query/el email de un backlog inusualmente
 * grande (ej. una primera corrida contra datos migrados), no un filtro de "recientes".
 */
const LIMITE_CARGAS = 300;

/** Qué llamó la atención, en palabras simples (el aviso no dice "sospechosa": pide revisar). */
const MOTIVO_LABEL: Record<string, string> = {
  litros_extremo: 'Los litros parecen demasiados o muy pocos',
  importe_invalido: 'El importe no parece correcto',
  precio_litro_fuera_de_rango: 'El precio por litro no es el habitual',
  km_delta_invalido: 'El kilometraje no coincide con las cargas anteriores',
  costo_km_invalido: 'El gasto por kilómetro no es el habitual',
};

/**
 * Todas las cargas de combustible marcadas `sospechoso` del tenant — sin ventana de
 * fecha. `CargaCombustible.fecha` es la fecha operativa de la carga (cuándo se cargó
 * combustible), no cuándo se la marcó sospechosa, y fase 2/3 puede marcar como
 * sospechosa una carga de fecha vieja recién ahora (al aparecer una carga vecina
 * nueva que revela una cadena de km inconsistente) — filtrar por fecha reciente
 * dejaría esos casos afuera para siempre. El dedup por `entidadId` en
 * `NotificacionEnvio` es lo que garantiza que cada carga se avise una sola vez, no
 * la ventana de fecha.
 */
@Injectable()
export class CargaSospechosaEvaluator implements NotificacionEvaluator {
  readonly tipo = 'combustible.cargaSospechosa';

  constructor(private readonly prisma: PrismaService) {}

  async evaluar(tenantId: string): Promise<NotificacionItem[]> {
    const cargas = await this.prisma.cargaCombustible.findMany({
      where: { tenantId, sospechoso: true },
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
      take: LIMITE_CARGAS,
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

    return cargas.map((c) => {
      const vehiculo = c.vehiculoId ? (patenteVehiculo.get(c.vehiculoId) ?? 'un vehículo') : 'un vehículo sin patente';
      const motivo = MOTIVO_LABEL[c.motivoSospecha ?? ''] ?? 'Algún dato no parece correcto';
      // Día sin hora (medianoche UTC): se formatea en UTC para no mostrar el día anterior.
      const fecha = c.fecha.toLocaleDateString('es-AR', { timeZone: 'UTC' });
      return {
        entidadId: c.id,
        titulo: `Revisá la carga de ${vehiculo} en ${c.estacion}`,
        detalle: `${motivo} · ${fecha} · ${c.litros.toLocaleString('es-AR')} L · $${c.importe.toLocaleString('es-AR')}`,
        url: `/combustible?carga=${encodeURIComponent(c.id)}`,
        tono: 'aviso' as const,
        subtitulo: `${fecha} · ${c.litros.toLocaleString('es-AR')} litros`,
        etiqueta: motivo,
        importe: { monto: c.importe, moneda: 'ARS' },
      };
    });
  }
}
