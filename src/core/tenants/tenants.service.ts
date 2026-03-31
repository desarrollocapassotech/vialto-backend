import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findAllPaginated(query: ListTenantsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const search = query.search?.trim();

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { clerkOrgId: { contains: search, mode: 'insensitive' as const } },
            { cuit: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  }

  async findOne(clerkOrgId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { clerkOrgId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    return tenant;
  }

  async create(dto: CreateTenantDto, requesterUserId?: string) {
    if (dto.cuit) {
      const existing = await this.prisma.tenant.findFirst({
        where: { cuit: dto.cuit },
      });
      if (existing) throw new ConflictException('Ya existe un tenant con ese CUIT');
    }

    let clerkOrgId = dto.clerkOrgId?.trim();
    let createdOrgId: string | null = null;

    if (!clerkOrgId) {
      try {
        const org = await clerk.organizations.createOrganization({
          name: dto.name.trim(),
          createdBy: requesterUserId,
        });
        clerkOrgId = org.id;
        createdOrgId = org.id;
      } catch {
        throw new InternalServerErrorException(
          'No se pudo crear la organización en Clerk',
        );
      }
    }

    try {
      return await this.prisma.tenant.create({
        data: {
          clerkOrgId,
          name: dto.name,
          cuit: dto.cuit ?? null,
          modules: dto.modules ?? [],
          maxUsers: 10,
        },
      });
    } catch (error) {
      if (createdOrgId) {
        try {
          await clerk.organizations.deleteOrganization(createdOrgId);
        } catch {
          // Si falla rollback en Clerk, priorizamos error funcional principal.
        }
      }
      throw error;
    }
  }

  async update(clerkOrgId: string, dto: UpdateTenantDto) {
    await this.findOne(clerkOrgId);
    return this.prisma.tenant.update({
      where: { clerkOrgId },
      data: {
        ...dto,
        billingRenewsAt:
          dto.billingRenewsAt === undefined
            ? undefined
            : dto.billingRenewsAt
              ? new Date(dto.billingRenewsAt)
              : null,
      },
    });
  }

  async setModules(clerkOrgId: string, modules: string[]) {
    await this.findOne(clerkOrgId);
    return this.prisma.tenant.update({ where: { clerkOrgId }, data: { modules } });
  }

  async remove(clerkOrgId: string) {
    await this.findOne(clerkOrgId);
    await clerk.organizations.deleteOrganization(clerkOrgId);
    return this.prisma.tenant.delete({ where: { clerkOrgId } });
  }
}
