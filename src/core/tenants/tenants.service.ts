import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { TenantBootstrapService } from '../../shared/tenant-bootstrap.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

function isClerkNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    status?: number;
    statusCode?: number;
    message?: string;
    errors?: Array<{ code?: string; longMessage?: string; message?: string }>;
  };

  if (e.status === 404 || e.statusCode === 404) return true;
  if (typeof e.message === 'string' && e.message.toLowerCase().includes('not found')) {
    return true;
  }
  if (Array.isArray(e.errors)) {
    return e.errors.some((item) => {
      const code = item.code?.toLowerCase() ?? '';
      const longMessage = item.longMessage?.toLowerCase() ?? '';
      const message = item.message?.toLowerCase() ?? '';
      return (
        code.includes('not_found') ||
        longMessage.includes('not found') ||
        message.includes('not found')
      );
    });
  }
  return false;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantBootstrap: TenantBootstrapService,
  ) {}

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
            { idFiscal: { contains: search, mode: 'insensitive' as const } },
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
    return this.withPaisOrigenDestinoFijo(tenant);
  }

  /**
   * Resuelve `paisOrigenDestinoFijoId` (id de Pais, catálogo del tenant) contra el
   * código de 2 letras real — computado, no vive en la tabla `tenants`. Mismo flag
   * (`paisOrigenDestinoOculto`/`paisOrigenDestinoFijoId`) se reusa para Viajes,
   * Clientes y Transportistas: el código resuelto acá alcanza para los tres, sin
   * que cada pantalla tenga que resolver el id contra el catálogo de países.
   */
  private async withPaisOrigenDestinoFijo<T extends { paisOrigenDestinoFijoId: string | null }>(
    tenant: T,
  ) {
    if (!tenant.paisOrigenDestinoFijoId) {
      return { ...tenant, paisOrigenDestinoFijoCodigo: null, paisOrigenDestinoFijoNombre: null };
    }
    const pais = await this.prisma.pais.findUnique({
      where: { id: tenant.paisOrigenDestinoFijoId },
    });
    return {
      ...tenant,
      paisOrigenDestinoFijoCodigo: pais?.codigo ?? null,
      paisOrigenDestinoFijoNombre: pais?.nombre ?? null,
    };
  }

  /** Registra la org de Clerk en Vialto si aún no existe (onboarding automático). */
  ensureRegistered(clerkOrgId: string) {
    return this.tenantBootstrap.ensureRegistered(clerkOrgId);
  }

  async create(dto: CreateTenantDto, requesterUserId?: string) {
    if (dto.idFiscal) {
      const existing = await this.prisma.tenant.findFirst({
        where: { idFiscal: dto.idFiscal },
      });
      if (existing) throw new ConflictException('Ya existe un tenant con ese ID fiscal');
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
      const tenant = await this.prisma.tenant.create({
        data: {
          clerkOrgId,
          name: dto.name,
          idFiscal: dto.idFiscal ?? null,
          modules: dto.modules ?? [],
          maxUsers: 10,
        },
      });
      await this.tenantBootstrap.seedDefaultPresentaciones(tenant.clerkOrgId);
      await this.tenantBootstrap.seedDefaultPaises(tenant.clerkOrgId);
      await this.tenantBootstrap.seedDefaultFieldConfigs(tenant.clerkOrgId);
      return tenant;
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

  /**
   * Valida las reglas de dependencia entre los 3 identificadores de Viaje
   * (ID Sistema, ID Propio 1, ID Propio 2) y aplica la cascada de apagado.
   * Muta `data` in-place cuando corresponde forzar idPropio2Habilitado=false.
   * No puede ser un constraint de Prisma (lógica cruzada entre 3 booleans).
   */
  private assertIdentificadoresValidos(
    current: { idSistemaHabilitado: boolean; idPropio1Habilitado: boolean; idPropio2Habilitado: boolean },
    dto: UpdateTenantDto,
    data: Record<string, unknown>,
  ): void {
    const tocaIdentificadores =
      dto.idSistemaHabilitado !== undefined ||
      dto.idPropio1Habilitado !== undefined ||
      dto.idPropio2Habilitado !== undefined;
    if (!tocaIdentificadores) return;

    const nextSistema = dto.idSistemaHabilitado ?? current.idSistemaHabilitado;
    const nextPropio1 = dto.idPropio1Habilitado ?? current.idPropio1Habilitado;
    let nextPropio2 = dto.idPropio2Habilitado ?? current.idPropio2Habilitado;

    // Cascada silenciosa: apagar Propio 1 sin una decisión explícita sobre
    // Propio 2 en el mismo request lo apaga también.
    if (dto.idPropio1Habilitado === false && dto.idPropio2Habilitado === undefined) {
      nextPropio2 = false;
      data.idPropio2Habilitado = false;
    }

    if (!nextSistema && !nextPropio1) {
      throw new BadRequestException(
        'Al menos uno de "ID Sistema" o "ID Propio 1" tiene que quedar habilitado.',
      );
    }
    if (nextPropio2 && !nextPropio1) {
      throw new BadRequestException(
        'Para habilitar "ID Propio 2" primero tiene que estar habilitado "ID Propio 1".',
      );
    }
  }

  async update(clerkOrgId: string, dto: UpdateTenantDto) {
    const current = await this.findOne(clerkOrgId);
    const data: Record<string, unknown> = {
      ...dto,
      billingStatus: dto.billingStatus,
      billingRenewsAt:
        dto.billingRenewsAt === undefined
          ? undefined
          : dto.billingRenewsAt
            ? new Date(dto.billingRenewsAt)
            : null,
    };
    this.assertIdentificadoresValidos(current, dto, data);
    return this.prisma.tenant.update({
      where: { clerkOrgId },
      data,
    });
  }

  async setModules(clerkOrgId: string, modules: string[]) {
    await this.findOne(clerkOrgId);
    return this.prisma.tenant.update({ where: { clerkOrgId }, data: { modules } });
  }

  async remove(clerkOrgId: string) {
    await this.findOne(clerkOrgId);
    try {
      await clerk.organizations.deleteOrganization(clerkOrgId);
    } catch (error) {
      if (!isClerkNotFoundError(error)) {
        throw new InternalServerErrorException(
          'No se pudo eliminar la organización en Clerk',
        );
      }
      // Si no existe en Clerk, igual limpiamos tenant local.
    }
    return this.prisma.tenant.delete({ where: { clerkOrgId } });
  }
}
