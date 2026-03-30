import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

const TAKE = 500;

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  listViajes(tenantId?: string) {
    if (!tenantId?.trim()) {
      return Promise.resolve([]);
    }
    const id = tenantId.trim();
    return this.prisma.viaje
      .findMany({
        where: { tenantId: id },
        take: TAKE,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true } } },
      })
      .then((rows) =>
        rows.map(({ tenant, ...rest }) => ({
          ...rest,
          empresaNombre: tenant.name,
        })),
      );
  }

  listClientes(tenantId?: string) {
    if (!tenantId?.trim()) {
      return Promise.resolve([]);
    }
    const id = tenantId.trim();
    return this.prisma.cliente
      .findMany({
        where: { tenantId: id },
        take: TAKE,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true } } },
      })
      .then((rows) =>
        rows.map(({ tenant, ...rest }) => ({
          ...rest,
          empresaNombre: tenant.name,
        })),
      );
  }

  listChoferes(tenantId?: string) {
    if (!tenantId?.trim()) {
      return Promise.resolve([]);
    }
    const id = tenantId.trim();
    return this.prisma.chofer
      .findMany({
        where: { tenantId: id },
        take: TAKE,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true } } },
      })
      .then((rows) =>
        rows.map(({ tenant, ...rest }) => ({
          ...rest,
          empresaNombre: tenant.name,
        })),
      );
  }

  listVehiculos(tenantId?: string) {
    if (!tenantId?.trim()) {
      return Promise.resolve([]);
    }
    const id = tenantId.trim();
    return this.prisma.vehiculo
      .findMany({
        where: { tenantId: id },
        take: TAKE,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true } } },
      })
      .then((rows) =>
        rows.map(({ tenant, ...rest }) => ({
          ...rest,
          empresaNombre: tenant.name,
        })),
      );
  }
}
