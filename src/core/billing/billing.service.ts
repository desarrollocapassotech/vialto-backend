import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscription(clerkOrgId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { clerkOrgId },
      select: { modules: true, billingStatus: true, billingRenewsAt: true, maxUsers: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    return { tenantId: clerkOrgId, ...tenant };
  }

  async activateModule(clerkOrgId: string, moduleName: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { clerkOrgId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const modules = Array.from(new Set([...tenant.modules, moduleName]));
    await this.prisma.tenant.update({ where: { clerkOrgId }, data: { modules } });
    return { tenantId: clerkOrgId, moduleName, action: 'activated', modules };
  }

  async deactivateModule(clerkOrgId: string, moduleName: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { clerkOrgId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const modules = tenant.modules.filter((m) => m !== moduleName);
    await this.prisma.tenant.update({ where: { clerkOrgId }, data: { modules } });
    return { tenantId: clerkOrgId, moduleName, action: 'deactivated', modules };
  }
}
