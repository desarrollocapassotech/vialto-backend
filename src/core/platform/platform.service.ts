import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateClienteDto } from '../clientes/dto/create-cliente.dto';
import { UpdateClienteDto } from '../clientes/dto/update-cliente.dto';
import { CreateChoferDto } from '../choferes/dto/create-chofer.dto';
import { UpdateChoferDto } from '../choferes/dto/update-chofer.dto';
import { CreateVehiculoDto } from '../vehiculos/dto/create-vehiculo.dto';
import { UpdateVehiculoDto } from '../vehiculos/dto/update-vehiculo.dto';
import { CreateTransportistaDto } from '../transportistas/dto/create-transportista.dto';
import { UpdateTransportistaDto } from '../transportistas/dto/update-transportista.dto';
import { CreateViajeDto } from '../../modules/viajes/dto/create-viaje.dto';
import {
  VIAJE_INCLUDE_VEHICULOS,
  type ViajeConVehiculosViaje,
} from '../../modules/viajes/viaje-vehiculos.helper';
import { UpdateViajeDto } from '../../modules/viajes/dto/update-viaje.dto';
import {
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from '../../shared/util/factura-estado-lectura';
import { createClerkClient } from '@clerk/backend';
import { ViajesService } from '../../modules/viajes/viajes.service';
import { StockService } from '../../modules/stock/stock.service';
import { ProductosPaginatedQueryDto } from '../../modules/stock/dto/productos-paginated-query.dto';
import { CreateProductoDto } from '../../modules/stock/dto/create-producto.dto';
import { UpdateProductoDto } from '../../modules/stock/dto/update-producto.dto';
import { CreatePresentacionDto } from '../../modules/stock/dto/create-presentacion.dto';
import { UpdatePresentacionDto } from '../../modules/stock/dto/update-presentacion.dto';
import { CreateIngresoDto } from '../../modules/stock/dto/create-ingreso.dto';

const TAKE = 500;
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

function toClerkOrganizationRole(appRole: string): string {
  if (appRole === 'admin') return 'org:admin';
  return 'org:member';
}

function toVialtoRole(appRole: string): string {
  if (appRole === 'admin') return 'admin';
  return 'operador';
}

function splitFullName(fullName: string) {
  const normalized = fullName.trim().replace(/\s+/g, ' ');
  const [firstName = '', ...rest] = normalized.split(' ');
  return { firstName, lastName: rest.join(' ') || undefined };
}

function isClerkNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as {
    status?: number;
    errors?: Array<{ code?: string }>;
  };
  if (maybe.status === 404) return true;
  return Array.isArray(maybe.errors)
    ? maybe.errors.some((e) => e?.code === 'resource_not_found')
    : false;
}

async function getUserPlatformRole(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const user = await clerk.users.getUser(userId);
    const rawRole = user.publicMetadata?.vialtoRole;
    return typeof rawRole === 'string' ? rawRole : null;
  } catch {
    return null;
  }
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viajesService: ViajesService,
    private readonly stockService: StockService,
  ) {}

  private requiredTenantId(tenantId?: string) {
    const id = tenantId?.trim();
    if (!id) {
      throw new BadRequestException('tenantId es requerido');
    }
    return id;
  }

  private async assertTransportistaExists(scopedTenantId: string, id: string) {
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId: scopedTenantId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
  }

  private async assertTenantExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { clerkOrgId: tenantId } });
    if (!tenant) throw new BadRequestException('Empresa inválida');
  }

  private async assertTransportista(tenantId: string, transportistaId?: string) {
    if (!transportistaId) return;
    const t = await this.prisma.transportista.findFirst({
      where: { id: transportistaId, tenantId },
    });
    if (!t) throw new BadRequestException('Transportista inválido para esta empresa');
  }

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
        include: {
          tenant: { select: { name: true } },
          ...VIAJE_INCLUDE_VEHICULOS,
        },
      })
      .then((rows) =>
        rows.map(({ tenant, ...rest }) => ({
          ...rest,
          empresaNombre: tenant.name,
        })),
      );
  }


  async getViajeById(tenantId: string | undefined, id: string): Promise<ViajeConVehiculosViaje> {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.viajesService.findOne(id, scopedTenantId);
  }

  async createViaje(tenantId: string, dto: CreateViajeDto, userId?: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTenantExists(scopedTenantId);
    return this.viajesService.create(scopedTenantId, userId ?? 'superadmin', dto);
  }

  async updateViaje(tenantId: string | undefined, id: string, dto: UpdateViajeDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.viajesService.update(id, scopedTenantId, dto);
  }

  async removeViaje(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.viajesService.remove(id, scopedTenantId);
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

  async getClienteById(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const row = await this.prisma.cliente.findFirst({
      where: { id, tenantId: scopedTenantId },
    });
    if (!row) throw new NotFoundException('Cliente no encontrado');
    return row;
  }

  async createCliente(tenantId: string | undefined, dto: CreateClienteDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTenantExists(scopedTenantId);
    return this.prisma.cliente.create({
      data: {
        tenantId: scopedTenantId,
        nombre: dto.nombre,
        idFiscal: dto.idFiscal ?? null,
        email: dto.email ?? null,
        telefono: dto.telefono ?? null,
        direccion: dto.direccion ?? null,
        pais: dto.pais ?? null,
      },
    });
  }

  async updateCliente(tenantId: string | undefined, id: string, dto: UpdateClienteDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.getClienteById(scopedTenantId, id);
    return this.prisma.cliente.update({
      where: { id },
      data: dto,
    });
  }

  async removeCliente(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.getClienteById(scopedTenantId, id);
    return this.prisma.cliente.delete({ where: { id } });
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

  async getChoferById(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const row = await this.prisma.chofer.findFirst({
      where: { id, tenantId: scopedTenantId },
    });
    if (!row) throw new NotFoundException('Chofer no encontrado');
    return row;
  }

  async createChofer(tenantId: string | undefined, dto: CreateChoferDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTenantExists(scopedTenantId);
    await this.assertTransportista(scopedTenantId, dto.transportistaId);
    return this.prisma.chofer.create({
      data: {
        tenantId: scopedTenantId,
        nombre: dto.nombre,
        dni: dto.dni ?? null,
        licencia: dto.licencia ?? null,
        licenciaVence: dto.licenciaVence ? new Date(dto.licenciaVence) : null,
        telefono: dto.telefono ?? null,
        transportistaId: dto.transportistaId ?? null,
      },
    });
  }

  async updateChofer(tenantId: string | undefined, id: string, dto: UpdateChoferDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.getChoferById(scopedTenantId, id);
    if (dto.transportistaId !== undefined) {
      await this.assertTransportista(scopedTenantId, dto.transportistaId ?? undefined);
    }
    return this.prisma.chofer.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        dni: dto.dni,
        licencia: dto.licencia,
        telefono: dto.telefono,
        transportistaId:
          dto.transportistaId === undefined ? undefined : dto.transportistaId,
        licenciaVence:
          dto.licenciaVence === undefined
            ? undefined
            : dto.licenciaVence
              ? new Date(dto.licenciaVence)
              : null,
      },
    });
  }

  async removeChofer(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.getChoferById(scopedTenantId, id);
    return this.prisma.chofer.delete({ where: { id } });
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

  listTransportistas(tenantId?: string) {
    if (!tenantId?.trim()) {
      return Promise.resolve([]);
    }
    const id = tenantId.trim();
    return this.prisma.transportista
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

  async getTransportistaById(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId: scopedTenantId },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
    return row;
  }

  async createTransportista(tenantId: string | undefined, dto: CreateTransportistaDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTenantExists(scopedTenantId);
    return this.prisma.transportista.create({
      data: {
        tenantId: scopedTenantId,
        nombre: dto.nombre,
        idFiscal: dto.idFiscal ?? null,
        email: dto.email ?? null,
        telefono: dto.telefono ?? null,
      },
    });
  }

  async updateTransportista(
    tenantId: string,
    id: string,
    dto: UpdateTransportistaDto,
  ) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTransportistaExists(scopedTenantId, id);
    return this.prisma.transportista.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        idFiscal: dto.idFiscal,
        email: dto.email,
        telefono: dto.telefono,
      },
    });
  }

  async removeTransportista(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTransportistaExists(scopedTenantId, id);
    return this.prisma.transportista.delete({ where: { id } });
  }

  async listUsers(tenantId?: string) {
    if (!tenantId?.trim()) {
      return [];
    }
    const organizationId = tenantId.trim();
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId,
    });
    return Promise.all(
      memberships.data.map(async (m) => {
        const userId = m.publicUserData?.userId ?? null;
        return {
          userId,
          firstName: m.publicUserData?.firstName ?? null,
          lastName: m.publicUserData?.lastName ?? null,
          email: m.publicUserData?.identifier ?? null,
          role: m.role,
          platformRole: await getUserPlatformRole(userId),
          createdAt: m.createdAt,
        };
      }),
    );
  }

  async getUserById(tenantId: string | undefined, userId: string) {
    const organizationId = this.requiredTenantId(tenantId);
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId,
    });
    const membership = memberships.data.find((m) => m.publicUserData?.userId === userId);
    if (!membership) {
      throw new NotFoundException('Usuario no encontrado en esta empresa');
    }
    const resolvedUserId = membership.publicUserData?.userId ?? null;
    return {
      userId: resolvedUserId,
      firstName: membership.publicUserData?.firstName ?? null,
      lastName: membership.publicUserData?.lastName ?? null,
      email: membership.publicUserData?.identifier ?? null,
      role: membership.role,
      platformRole: await getUserPlatformRole(resolvedUserId),
      createdAt: membership.createdAt,
    };
  }

  async inviteUser(
    tenantId: string,
    name: string,
    emailAddress: string,
    password: string,
    role: string,
  ) {
    const organizationId = this.requiredTenantId(tenantId);
    const normalizedName = name.trim();
    const normalizedEmail = emailAddress.trim().toLowerCase();
    if (!normalizedName) {
      throw new BadRequestException('Nombre requerido');
    }
    if (!normalizedEmail) {
      throw new BadRequestException('Email requerido');
    }
    if (!password) {
      throw new BadRequestException('Contraseña requerida');
    }
    if (password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const { firstName, lastName } = splitFullName(normalizedName);

    const users = await clerk.users.getUserList({
      emailAddress: [normalizedEmail],
      limit: 1,
    });
    let userId = users.data[0]?.id;

    if (!userId) {
      const created = await clerk.users.createUser({
        emailAddress: [normalizedEmail],
        firstName,
        lastName,
        password,
        skipPasswordChecks: true,
        skipPasswordRequirement: false,
      });
      userId = created.id;
    }

    await clerk.users.updateUser(userId, {
      firstName,
      lastName,
      password,
      skipPasswordChecks: true,
    });
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        vialtoRole: toVialtoRole(role),
        tenantId: organizationId,
      },
    });

    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId,
    });
    const alreadyMember = memberships.data.some(
      (m) => m.publicUserData?.userId === userId,
    );

    if (alreadyMember) {
      await clerk.organizations.updateOrganizationMembership({
        organizationId,
        userId,
        role: toClerkOrganizationRole(role),
      });
      return { userId, organizationId, action: 'role-updated' };
    }

    await clerk.organizations.createOrganizationMembership({
      organizationId,
      userId,
      role: toClerkOrganizationRole(role),
    });
    return { userId, organizationId, action: 'created-and-added' };
  }

  async updateUserRole(tenantId: string | undefined, userId: string, role: string) {
    const organizationId = this.requiredTenantId(tenantId);
    const result = await clerk.organizations.updateOrganizationMembership({
      organizationId,
      userId,
      role: toClerkOrganizationRole(role),
    });
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        vialtoRole: toVialtoRole(role),
        tenantId: organizationId,
      },
    });
    return result;
  }

  async removeUser(tenantId: string | undefined, userId: string) {
    const organizationId = this.requiredTenantId(tenantId);
    let membershipRemoved = false;
    let userDeleted = false;

    try {
      await clerk.organizations.deleteOrganizationMembership({
        organizationId,
        userId,
      });
      membershipRemoved = true;
    } catch (error) {
      if (!isClerkNotFound(error)) {
        throw error;
      }
    }

    try {
      await clerk.users.deleteUser(userId);
      userDeleted = true;
    } catch (error) {
      if (!isClerkNotFound(error)) {
        throw error;
      }
    }

    return {
      organizationId,
      userId,
      membershipRemoved,
      userDeleted,
    };
  }

  async getVehiculoById(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const row = await this.prisma.vehiculo.findFirst({
      where: { id, tenantId: scopedTenantId },
    });
    if (!row) throw new NotFoundException('Vehículo no encontrado');
    return row;
  }

  async createVehiculo(tenantId: string | undefined, dto: CreateVehiculoDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTenantExists(scopedTenantId);
    await this.assertTransportista(scopedTenantId, dto.transportistaId);
    return this.prisma.vehiculo.create({
      data: {
        tenantId: scopedTenantId,
        patente: dto.patente.toUpperCase(),
        tipo: dto.tipo,
        marca: dto.marca ?? null,
        modelo: dto.modelo ?? null,
        anio: dto.anio ?? null,
        kmActual: dto.kmActual ?? 0,
        transportistaId: dto.transportistaId ?? null,
      },
    });
  }

  async updateVehiculo(tenantId: string | undefined, id: string, dto: UpdateVehiculoDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.getVehiculoById(scopedTenantId, id);
    if (dto.transportistaId !== undefined) {
      await this.assertTransportista(scopedTenantId, dto.transportistaId ?? undefined);
    }
    return this.prisma.vehiculo.update({
      where: { id },
      data: {
        patente: dto.patente ? dto.patente.toUpperCase() : undefined,
        tipo: dto.tipo,
        marca: dto.marca,
        modelo: dto.modelo,
        anio: dto.anio,
        kmActual: dto.kmActual,
        transportistaId:
          dto.transportistaId === undefined ? undefined : dto.transportistaId,
      },
    });
  }

  async removeVehiculo(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.getVehiculoById(scopedTenantId, id);
    return this.prisma.vehiculo.delete({ where: { id } });
  }

  // ── Facturación (superadmin) ─────────────────────────────────────────────

  async listFacturas(tenantId?: string) {
    if (!tenantId?.trim()) return Promise.resolve([]);
    const id = tenantId.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.prisma.factura as any).findMany({
      where: { tenantId: id },
      orderBy: { fechaEmision: 'desc' },
      include: {
        viajes: { select: { id: true, estado: true, monto: true } },
        pagos: { select: { importe: true } },
      },
      take: TAKE,
    });
    return rows.map(
      ({
        viajes,
        pagos = [],
        ...f
      }: {
        viajes: { id: string; estado: string; monto: number | null }[];
        pagos?: { importe: number }[];
        [k: string]: unknown;
      }) => {
        const importeGuardado = Number(f.importe ?? 0);
        const importe = importeOperativoFactura(importeGuardado, viajes);
        return {
          ...f,
          viajeIds: viajes.map((v) => v.id),
          importe,
          estado: computeEstadoFacturaLectura({
            viajes,
            fechaVencimiento: (f.fechaVencimiento as Date | null) ?? null,
            importeGuardado,
            pagos: pagos ?? [],
          }),
        };
      },
    );
  }

  async updateFactura(
    tenantId: string,
    id: string,
    data: { estado?: string; fechaVencimiento?: string | null },
  ) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const row = await this.prisma.factura.findFirst({
      where: { id, tenantId: scopedTenantId },
    });
    if (!row) throw new NotFoundException('Factura no encontrada');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.factura.update({
        where: { id },
        data: {
          ...(data.estado !== undefined ? { estado: data.estado } : {}),
          ...(data.fechaVencimiento !== undefined
            ? {
                fechaVencimiento: data.fechaVencimiento
                  ? new Date(data.fechaVencimiento)
                  : null,
              }
            : {}),
        },
        include: { pagos: true },
      });
      // El estado cobrada/vencida/pendiente se deriva automáticamente en la capa de lectura
      return updated;
    });
  }

  async createPago(
    tenantId: string,
    dto: { facturaId: string; importe: number; fecha: string; formaPago?: string },
  ) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const factura = await this.prisma.factura.findFirst({
      where: { id: dto.facturaId, tenantId: scopedTenantId },
    });
    if (!factura) throw new NotFoundException('Factura no encontrada');
    return this.prisma.pago.create({
      data: {
        tenantId: scopedTenantId,
        facturaId: dto.facturaId,
        importe: dto.importe,
        fecha: new Date(dto.fecha),
        formaPago: (dto.formaPago ?? null),
      },
    });
  }

  async deletePago(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const row = await this.prisma.pago.findFirst({
      where: { id, tenantId: scopedTenantId },
    });
    if (!row) throw new NotFoundException('Pago no encontrado');
    return this.prisma.pago.delete({ where: { id } });
  }

  async createFactura(
    tenantId: string,
    dto: {
      numero: string;
      tipo: string;
      clienteId?: string;
      viajeIds?: string[];
      importe?: number;
      fechaEmision: string;
      fechaVencimiento?: string;
      estado?: string;
    },
  ) {
    const tid = this.requiredTenantId(tenantId);
    const viajeIds = dto.viajeIds ?? [];
    return this.prisma.$transaction(async (tx) => {
      const factura = await tx.factura.create({
        data: {
          tenantId: tid,
          numero: dto.numero,
          tipo: dto.tipo,
          clienteId: dto.clienteId ?? null,
          importe: dto.importe ?? 0,
          fechaEmision: new Date(dto.fechaEmision),
          fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
          estado: (dto.estado ?? 'pendiente'),
        },
      });
      if (viajeIds.length > 0) {
        await tx.viaje.updateMany({
          where: { id: { in: viajeIds }, tenantId: tid },
          data: { facturaId: factura.id },
        });
      }
      return tx.factura.findFirst({ where: { id: factura.id }, include: { pagos: true } });
    });
  }

  async removeFactura(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const row = await this.prisma.factura.findFirst({
      where: { id, tenantId: scopedTenantId },
    });
    if (!row) throw new NotFoundException('Factura no encontrada');
    return this.prisma.factura.delete({ where: { id } });
  }

  // ─── Productos (módulo stock) ────────────────────────────────────────────────

  listProductosPaginated(tenantId: string | undefined, query: ProductosPaginatedQueryDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.findAllProductosPaginated(scopedTenantId, query);
  }

  getProducto(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.findProducto(id, scopedTenantId);
  }

  async createProducto(tenantId: string | undefined, dto: CreateProductoDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTenantExists(scopedTenantId);
    return this.stockService.createProducto(scopedTenantId, dto);
  }

  updateProducto(tenantId: string | undefined, id: string, dto: UpdateProductoDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.updateProducto(id, scopedTenantId, dto);
  }

  listPresentaciones(tenantId: string | undefined, productoId: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.listPresentaciones(productoId, scopedTenantId);
  }

  createPresentacion(tenantId: string | undefined, productoId: string, dto: CreatePresentacionDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.createPresentacion(productoId, scopedTenantId, dto);
  }

  updatePresentacion(tenantId: string | undefined, productoId: string, id: string, dto: UpdatePresentacionDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.updatePresentacion(productoId, id, scopedTenantId, dto);
  }

  removePresentacion(tenantId: string | undefined, productoId: string, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.removePresentacion(productoId, id, scopedTenantId);
  }

  createIngreso(tenantId: string | undefined, dto: CreateIngresoDto, createdBy: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.createIngreso(scopedTenantId, dto, createdBy);
  }

  listIngresos(tenantId: string | undefined, clienteId?: string, productoId?: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.listIngresos(scopedTenantId, clienteId, productoId);
  }

  listStockDisponible(tenantId: string | undefined, clienteId?: string, productoId?: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.listStockDisponible(scopedTenantId, clienteId, productoId);
  }
}
