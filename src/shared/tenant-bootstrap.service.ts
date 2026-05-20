import { Injectable } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from './prisma/prisma.service';
import { VIALTO_MODULES } from './types/modules';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

@Injectable()
export class TenantBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

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
      return await this.prisma.tenant.create({
        data: {
          clerkOrgId,
          name,
          modules: [...VIALTO_MODULES],
          maxUsers: 10,
          billingStatus: 'trial',
        },
      });
    } catch {
      const again = await this.prisma.tenant.findUnique({ where: { clerkOrgId } });
      if (again) return again;
      throw new Error(`No se pudo registrar el tenant ${clerkOrgId}`);
    }
  }
}
