import { Injectable } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from './prisma/prisma.service';
import { VIALTO_MODULES } from './types/modules';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const DEFAULT_PRESENTACIONES = ['Pallet', 'Unidad'] as const;

const DEFAULT_PAISES = [
  { nombre: 'Argentina', codigo: 'AR' },
  { nombre: 'Uruguay', codigo: 'UY' },
  { nombre: 'Paraguay', codigo: 'PY' },
  { nombre: 'Chile', codigo: 'CL' },
  { nombre: 'Brasil', codigo: 'BR' },
] as const;

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

  /** Países predefinidos (AR/UY/PY/CL/BR) — mismo listado del seed histórico
   * `20260807181010_seed_paises_predefinidos`. Sin esto, un tenant creado
   * después de esa migración arranca con el catálogo de países vacío. */
  async seedDefaultPaises(tenantId: string) {
    await this.prisma.pais.createMany({
      data: DEFAULT_PAISES.map(({ nombre, codigo }) => ({
        tenantId,
        nombre,
        codigo,
        esPredefinido: true,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Valores por defecto para nuevos tenants (VTO-371):
   * Los campos de fecha en liquidación ("fechaDesde", "fechaHasta") nacen deshabilitados (visible: false)
   * para nuevos tenants.
   */
  async seedDefaultFieldConfigs(tenantId: string) {
    const ocultosJson = {
      fechaDesde: { visible: false },
      fechaHasta: { visible: false },
    };
    await this.prisma.tenantFieldConfig.createMany({
      data: [
        {
          tenantId,
          modulo: 'liquidaciones',
          formulario: 'alta_liquidacion',
          campos: ocultosJson,
          updatedAt: new Date(),
          updatedBy: 'system',
        },
        {
          tenantId,
          modulo: 'liquidaciones',
          formulario: 'edicion_liquidacion',
          campos: ocultosJson,
          updatedAt: new Date(),
          updatedBy: 'system',
        },
      ],
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
      await this.seedDefaultPaises(tenant.clerkOrgId);
      await this.seedDefaultFieldConfigs(tenant.clerkOrgId);
      return tenant;
    } catch {
      const again = await this.prisma.tenant.findUnique({ where: { clerkOrgId } });
      if (again) return again;
      throw new Error(`No se pudo registrar el tenant ${clerkOrgId}`);
    }
  }
}
