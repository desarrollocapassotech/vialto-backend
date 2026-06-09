import { Injectable } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from './prisma/prisma.service';
import { VIALTO_MODULES } from './types/modules';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const DEFAULT_PRESENTACIONES = ['Pallet', 'Unidad'] as const;

function normalizarNombrePresentacion(nombre: string): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

@Injectable()
export class TenantBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

  async seedDefaultPresentaciones(tenantId: string) {
    await this.prisma.presentacion.createMany({
      data: DEFAULT_PRESENTACIONES.map((nombre) => ({
        tenantId,
        nombre,
        nombreNormalizado: normalizarNombrePresentacion(nombre),
        activo: true,
      })),
      skipDuplicates: true,
    });
  }

  async ensureRegistered(clerkOrgId: string) {
    const existing = await this.prisma.tenant.findUnique({ where: { clerkOrgId } });
    if (existing) return existing;

    let name = clerkOrgId;
    if (process.env.CLERK_SECRET_KEY) {
      try {
        const org = await clerk.organizations.getOrganization({ organizationId: clerkOrgId });
        name = org.name?.trim() || name;
      } catch {
        // nombre por defecto = orgId
      }
    }

    try {
      const tenant = await this.prisma.tenant.create({
        data: {
          clerkOrgId,
          name,
          modules: [...VIALTO_MODULES],
          maxUsers: 10,
          billingStatus: 'trial',
        },
      });
      await this.seedDefaultPresentaciones(tenant.clerkOrgId);
      return tenant;
    } catch {
      const again = await this.prisma.tenant.findUnique({ where: { clerkOrgId } });
      if (again) return again;
      throw new Error(`No se pudo registrar el tenant ${clerkOrgId}`);
    }
  }
}
