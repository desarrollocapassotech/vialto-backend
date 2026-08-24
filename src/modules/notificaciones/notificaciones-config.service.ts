import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { getNotificacionesCatalogoPorModulos, NOTIFICACIONES_CATALOG } from './notificaciones-catalog';

export type NotificacionConfigEfectiva = {
  tipo: string;
  modulo: string;
  label: string;
  descripcion: string;
  activo: boolean;
  /** userIds de Clerk elegidos a mano para este tipo. Vacío = default (todos los org:admin). */
  destinatarios: string[];
};

@Injectable()
export class NotificacionesConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catálogo de notificaciones aplicables + estado efectivo (override del tenant o default del catálogo), solo para los módulos que el tenant tiene contratados. */
  async getConfigEfectiva(tenantId: string): Promise<NotificacionConfigEfectiva[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    const catalogo = getNotificacionesCatalogoPorModulos(tenant?.modules ?? []);
    if (catalogo.length === 0) return [];

    const overrides = await this.prisma.notificacionConfig.findMany({
      where: { tenantId, tipo: { in: catalogo.map((c) => c.tipo) } },
      select: { tipo: true, activo: true, destinatarios: true },
    });
    const overridePorTipo = new Map(overrides.map((o) => [o.tipo, o]));

    return catalogo.map((c) => {
      const override = overridePorTipo.get(c.tipo);
      return {
        tipo: c.tipo,
        modulo: c.modulo,
        label: c.label,
        descripcion: c.descripcion,
        activo: override?.activo ?? c.defaultActivo,
        destinatarios: override?.destinatarios ?? [],
      };
    });
  }

  /** Estado efectivo (override o default) de UN tipo puntual — usado por el cron, no requiere traer todo el catálogo. */
  async isActivo(tenantId: string, tipo: string): Promise<boolean> {
    const item = NOTIFICACIONES_CATALOG.find((c) => c.tipo === tipo);
    const defaultActivo = item?.defaultActivo ?? true;
    const override = await this.prisma.notificacionConfig.findUnique({
      where: { tenantId_tipo: { tenantId, tipo } },
      select: { activo: true },
    });
    return override?.activo ?? defaultActivo;
  }

  /** Destinatarios elegidos a mano (userIds) para un tipo puntual — vacío = sin override, usar default (todos los admins). */
  async getDestinatarios(tenantId: string, tipo: string): Promise<string[]> {
    const override = await this.prisma.notificacionConfig.findUnique({
      where: { tenantId_tipo: { tenantId, tipo } },
      select: { destinatarios: true },
    });
    return override?.destinatarios ?? [];
  }

  async toggle(tenantId: string, tipo: string, activo: boolean, updatedBy: string): Promise<void> {
    const item = NOTIFICACIONES_CATALOG.find((c) => c.tipo === tipo);
    if (!item) {
      throw new BadRequestException(`Tipo de notificación desconocido: "${tipo}"`);
    }

    await this.prisma.notificacionConfig.upsert({
      where: { tenantId_tipo: { tenantId, tipo } },
      create: { tenantId, tipo, activo, updatedBy },
      update: { activo, updatedBy },
    });
  }

  /** Reemplaza la lista de destinatarios a mano de un tipo. Pasar `[]` vuelve al default (todos los admins). */
  async setDestinatarios(
    tenantId: string,
    tipo: string,
    destinatarios: string[],
    updatedBy: string,
  ): Promise<void> {
    const item = NOTIFICACIONES_CATALOG.find((c) => c.tipo === tipo);
    if (!item) {
      throw new BadRequestException(`Tipo de notificación desconocido: "${tipo}"`);
    }

    await this.prisma.notificacionConfig.upsert({
      where: { tenantId_tipo: { tenantId, tipo } },
      create: { tenantId, tipo, activo: item.defaultActivo, destinatarios, updatedBy },
      update: { destinatarios, updatedBy },
    });
  }
}
