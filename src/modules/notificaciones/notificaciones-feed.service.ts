import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NOTIFICACIONES_CATALOG } from './notificaciones-catalog';

export type NotificacionFeedItem = {
  id: string;
  tipo: string;
  entidadId: string;
  label: string;
  titulo: string;
  detalle: string;
  enviadoAt: Date;
  leido: boolean;
};

export type NotificacionFeed = {
  noLeidas: number;
  items: NotificacionFeedItem[];
};

/** Un grupo por tipo de aviso, para la página de Notificaciones (acordeones). */
export type NotificacionFeedGrupo = {
  tipo: string;
  label: string;
  total: number;
  noLeidas: number;
  /** Los más recientes del tipo (hasta `porTipo`); el resto se pide con `getFeed(..., tipo)`. */
  items: NotificacionFeedItem[];
};

function labelDeTipo(tipo: string): string {
  return NOTIFICACIONES_CATALOG.find((c) => c.tipo === tipo)?.label ?? tipo;
}

/** Feed de notificaciones para el ícono de campana — lee `NotificacionEnvio`, no vuelve a evaluar el catálogo. */
@Injectable()
export class NotificacionesFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(
    tenantId: string,
    userId: string,
    limit: number,
    tipo?: string,
    offset = 0,
  ): Promise<NotificacionFeed> {
    const where = { tenantId, ...(tipo ? { tipo } : {}) };
    const [envios, noLeidas] = await Promise.all([
      this.prisma.notificacionEnvio.findMany({
        where,
        orderBy: [{ enviadoAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.notificacionEnvio.count({
        where: { ...where, NOT: { leidoPor: { has: userId } } },
      }),
    ]);

    return { noLeidas, items: envios.map((e) => this.toItem(e, userId)) };
  }

  /**
   * Avisos agrupados por tipo: total, no leídos y los `porTipo` más recientes de cada uno.
   * Un tipo con muchos avisos (ej. cientos de cargas sospechosas) no tapa a los demás,
   * como pasaría con un "últimos N" global. Grupos ordenados por el aviso más reciente.
   */
  async getFeedAgrupado(
    tenantId: string,
    userId: string,
    porTipo: number,
  ): Promise<NotificacionFeedGrupo[]> {
    const [totales, noLeidos] = await Promise.all([
      this.prisma.notificacionEnvio.groupBy({
        by: ['tipo'],
        where: { tenantId },
        _count: { _all: true },
        _max: { enviadoAt: true },
      }),
      this.prisma.notificacionEnvio.groupBy({
        by: ['tipo'],
        where: { tenantId, NOT: { leidoPor: { has: userId } } },
        _count: { _all: true },
      }),
    ]);
    const noLeidosPorTipo = new Map(noLeidos.map((g) => [g.tipo, g._count._all]));

    const grupos = await Promise.all(
      totales
        .sort((a, b) => (b._max.enviadoAt?.getTime() ?? 0) - (a._max.enviadoAt?.getTime() ?? 0))
        .map(async (g) => {
          const envios = await this.prisma.notificacionEnvio.findMany({
            where: { tenantId, tipo: g.tipo },
            // Mismo orden que getFeed: el "Ver más" pagina con offset sobre esta lista.
            orderBy: [{ enviadoAt: 'desc' }, { id: 'desc' }],
            take: porTipo,
          });
          return {
            tipo: g.tipo,
            label: labelDeTipo(g.tipo),
            total: g._count._all,
            noLeidas: noLeidosPorTipo.get(g.tipo) ?? 0,
            items: envios.map((e) => this.toItem(e, userId)),
          };
        }),
    );
    return grupos;
  }

  private toItem(
    e: { id: string; tipo: string; entidadId: string; titulo: string; detalle: string; enviadoAt: Date; leidoPor: string[] },
    userId: string,
  ): NotificacionFeedItem {
    return {
      id: e.id,
      tipo: e.tipo,
      entidadId: e.entidadId,
      label: labelDeTipo(e.tipo),
      titulo: e.titulo,
      detalle: e.detalle,
      enviadoAt: e.enviadoAt,
      leido: e.leidoPor.includes(userId),
    };
  }

  /**
   * Marca como leídos, para el usuario actual, los avisos indicados por `ids` y/o `tipo`
   * (sin ninguno de los dos: todos los no leídos del tenant). Un solo UPDATE en la base —
   * un tipo puede tener cientos de avisos (ej. cargas sospechosas) y uno por uno no escala.
   */
  async marcarLeidas(tenantId: string, userId: string, ids?: string[], tipo?: string): Promise<void> {
    const porIds = ids && ids.length > 0;
    await this.prisma.$executeRaw`
      UPDATE "notificacion_envios"
      SET "leidoPor" = array_append("leidoPor", ${userId})
      WHERE "tenantId" = ${tenantId}
        AND NOT (${userId} = ANY("leidoPor"))
        AND (${!porIds} OR "id" = ANY(${porIds ? ids : []}::text[]))
        AND (${!tipo} OR "tipo" = ${tipo ?? ''})
    `;
  }
}
