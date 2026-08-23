import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NOTIFICACIONES_CATALOG } from './notificaciones-catalog';

export type NotificacionFeedItem = {
  id: string;
  tipo: string;
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

function labelDeTipo(tipo: string): string {
  return NOTIFICACIONES_CATALOG.find((c) => c.tipo === tipo)?.label ?? tipo;
}

/** Feed de notificaciones para el ícono de campana — lee `NotificacionEnvio`, no vuelve a evaluar el catálogo. */
@Injectable()
export class NotificacionesFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(tenantId: string, userId: string, limit: number): Promise<NotificacionFeed> {
    const [envios, noLeidas] = await Promise.all([
      this.prisma.notificacionEnvio.findMany({
        where: { tenantId },
        orderBy: { enviadoAt: 'desc' },
        take: limit,
      }),
      this.prisma.notificacionEnvio.count({
        where: { tenantId, NOT: { leidoPor: { has: userId } } },
      }),
    ]);

    return {
      noLeidas,
      items: envios.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        label: labelDeTipo(e.tipo),
        titulo: e.titulo,
        detalle: e.detalle,
        enviadoAt: e.enviadoAt,
        leido: e.leidoPor.includes(userId),
      })),
    };
  }

  /** Marca como leídos, para el usuario actual, los avisos indicados (o todos los no leídos del tenant si no se pasan ids). */
  async marcarLeidas(tenantId: string, userId: string, ids?: string[]): Promise<void> {
    const noLeidos = await this.prisma.notificacionEnvio.findMany({
      where: {
        tenantId,
        ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
        NOT: { leidoPor: { has: userId } },
      },
      select: { id: true },
    });
    if (noLeidos.length === 0) return;

    await this.prisma.$transaction(
      noLeidos.map((e) =>
        this.prisma.notificacionEnvio.update({
          where: { id: e.id },
          data: { leidoPor: { push: userId } },
        }),
      ),
    );
  }
}
