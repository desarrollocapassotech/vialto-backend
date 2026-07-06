import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { toClerkOrganizationRole, toDisplayOrgRole, toVialtoRole, isVialtoTenantRole } from '../auth/clerk-organization-roles';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

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
        const effectiveRole =
          platformRole && platformRole !== 'superadmin' && isVialtoTenantRole(platformRole)
            ? toDisplayOrgRole(platformRole)
            : m.role;

        return {
          userId,
          firstName: m.publicUserData?.firstName ?? null,
          lastName: m.publicUserData?.lastName ?? null,
          email: m.publicUserData?.identifier ?? null,
          role: effectiveRole,
          createdAt: m.createdAt,
          platformRole,
        };
      }),
    );

    return results.filter((u) => u.platformRole !== 'superadmin');
  }

  async create(tenantId: string, name: string, email: string, password: string, role: string) {
    const normalized = name.trim().replace(/\s+/g, ' ');
    const [firstName = '', ...rest] = normalized.split(' ');
    const lastName = rest.join(' ') || undefined;
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalized) throw new BadRequestException('El nombre es requerido');
    if (!normalizedEmail) throw new BadRequestException('El email es requerido');
    if (!password || password.length < 8)
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');

    const existing = await clerk.users.getUserList({ emailAddress: [normalizedEmail], limit: 1 });
    let userId = existing.data[0]?.id;
    const alreadyExisted = !!userId;

    if (!userId) {
      const created = await clerk.users.createUser({
        emailAddress: [normalizedEmail],
        firstName,
        lastName,
        password,
        skipPasswordChecks: true,
      });
      userId = created.id;
    }

    try {
      const memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: tenantId,
      });
      const alreadyMember = memberships.data.some((m) => m.publicUserData?.userId === userId);

      if (alreadyMember) {
        await clerk.organizations.updateOrganizationMembership({
          organizationId: tenantId,
          userId,
          role: toClerkOrganizationRole(role),
        });
      } else {
        await clerk.organizations.createOrganizationMembership({
          organizationId: tenantId,
          userId,
          role: toClerkOrganizationRole(role),
        });
      }

      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: {
          vialtoRole: toVialtoRole(role),
          tenantId,
        },
      });
    } catch (err) {
      if (!alreadyExisted) {
        await clerk.users.deleteUser(userId).catch(() => null);
      }

      const clerkError = (err as any)?.errors?.[0];

      if (clerkError?.code === 'organization_membership_quota_exceeded') {
        throw new ConflictException(
          'Límite de miembros alcanzado. Liberá espacio o contactá a un administrador.',
        );
      }

      throw err;
    }

    return { userId, action: alreadyExisted ? 'added-to-org' : 'created-and-added' };
  }

  async updateRole(tenantId: string, userId: string, role: string) {
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: tenantId,
    });
    const membership = memberships.data.find((m) => m.publicUserData?.userId === userId);
    if (!membership) throw new NotFoundException('Usuario no encontrado en esta organización');

    const result = await clerk.organizations.updateOrganizationMembership({
      organizationId: tenantId,
      userId,
      role: toClerkOrganizationRole(role),
    });
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        vialtoRole: toVialtoRole(role),
        tenantId,
      },
    });
    return result;
  }

  async removeFromOrg(tenantId: string, userId: string) {
    return clerk.organizations.deleteOrganizationMembership({
      organizationId: tenantId,
      userId,
    });
  }
}
