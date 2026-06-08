import { Injectable, NotFoundException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

function toClerkOrganizationRole(appRole: string): string {
  if (appRole === 'admin') return 'org:admin';
  return 'org:member';
}

async function getPlatformRole(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const user = await clerk.users.getUser(userId);
    const raw = user.publicMetadata?.vialtoRole;
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

@Injectable()
export class UsersService {
  /**
   * Lista los miembros de la organización, excluyendo superadmins de plataforma.
   * Clerk es la fuente de verdad para usuarios — no se duplican en Postgres.
   */
  async listByTenant(tenantId: string) {
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: tenantId,
    });

    const results = await Promise.all(
      memberships.data.map(async (m) => {
        const userId = m.publicUserData?.userId ?? null;
        const platformRole = await getPlatformRole(userId);
        return {
          userId,
          firstName: m.publicUserData?.firstName ?? null,
          lastName: m.publicUserData?.lastName ?? null,
          email: m.publicUserData?.identifier ?? null,
          role: m.role,
          createdAt: m.createdAt,
          platformRole,
        };
      }),
    );

    return results.filter((u) => u.platformRole !== 'superadmin');
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
