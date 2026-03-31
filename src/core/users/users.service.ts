import { Injectable, NotFoundException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

function toClerkOrganizationRole(appRole: string): string {
  if (appRole === 'admin') return 'org:admin';
  return 'org:member';
}

@Injectable()
export class UsersService {
  /**
   * Lista los miembros de una organización de Clerk.
   * Clerk es la fuente de verdad para usuarios — no se duplican en Postgres.
   */
  async listByTenant(tenantId: string) {
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: tenantId,
    });

    return memberships.data.map((m) => ({
      userId: m.publicUserData?.userId,
      firstName: m.publicUserData?.firstName,
      lastName: m.publicUserData?.lastName,
      email: m.publicUserData?.identifier,
      role: m.role,
      createdAt: m.createdAt,
    }));
  }

  async inviteToOrg(tenantId: string, emailAddress: string, role: string) {
    return clerk.organizations.createOrganizationInvitation({
      organizationId: tenantId,
      emailAddress,
      role: toClerkOrganizationRole(role),
      redirectUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    });
  }

  async updateRole(tenantId: string, userId: string, role: string) {
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: tenantId,
    });
    const membership = memberships.data.find((m) => m.publicUserData?.userId === userId);
    if (!membership) throw new NotFoundException('Usuario no encontrado en esta organización');

    return clerk.organizations.updateOrganizationMembership({
      organizationId: tenantId,
      userId,
      role: toClerkOrganizationRole(role),
    });
  }

  async removeFromOrg(tenantId: string, userId: string) {
    return clerk.organizations.deleteOrganizationMembership({
      organizationId: tenantId,
      userId,
    });
  }
}
