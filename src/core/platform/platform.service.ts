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
import { AddGastoDto } from '../../modules/viajes/dto/add-gasto.dto';
import { AddPagoTransportistaDto } from '../../modules/viajes/dto/add-pago-transportista.dto';
import { ViajesPaginatedQueryDto } from '../../modules/viajes/dto/viajes-paginated-query.dto';
import { MicCrtService } from '../../modules/viajes/mic-crt.service';
import { PautService } from '../../modules/viajes/paut.service';
import { FacturacionService } from '../../modules/facturacion/facturacion.service';
import { CreateFacturaDto } from '../../modules/facturacion/dto/create-factura.dto';
import { UpdateFacturaDto } from '../../modules/facturacion/dto/update-factura.dto';
import { CreatePagoDto } from '../../modules/facturacion/dto/create-pago.dto';
import { createClerkClient } from '@clerk/backend';
import { ViajesService } from '../../modules/viajes/viajes.service';
import { StockService } from '../../modules/stock/stock.service';
import { ProductosPaginatedQueryDto } from '../../modules/stock/dto/productos-paginated-query.dto';
import { CreateProductoDto } from '../../modules/stock/dto/create-producto.dto';
import { UpdateProductoDto } from '../../modules/stock/dto/update-producto.dto';
import { CreatePresentacionDto } from '../../modules/stock/dto/create-presentacion.dto';
import { UpdatePresentacionDto } from '../../modules/stock/dto/update-presentacion.dto';
import { CreateIngresoDto } from '../../modules/stock/dto/create-ingreso.dto';
import { CreateEgresoDto } from '../../modules/stock/dto/create-egreso.dto';
import { UpdateStockEgresoRemitoConfigDto } from '../../modules/stock/dto/update-stock-egreso-remito-config.dto';
import { ArcaConfigService } from '../../modules/liquidaciones-arca/arca-config.service';
import { LiquidacionesService } from '../../modules/liquidaciones-arca/liquidaciones.service';

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
    private readonly facturacionService: FacturacionService,
    private readonly micCrt: MicCrtService,
    private readonly paut: PautService,
    private readonly arcaConfigService: ArcaConfigService,
    private readonly liquidacionesService: LiquidacionesService,
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

  viajesPaginated(tenantId: string | undefined, query: ViajesPaginatedQueryDto) {
    const scoped = this.requiredTenantId(tenantId);
    return this.viajesService.findAllPaginated(scoped, query);
  }

  addViajeGasto(tenantId: string | undefined, viajeId: string, userId: string, dto: AddGastoDto) {
    const scoped = this.requiredTenantId(tenantId);
    return this.viajesService.addGasto(viajeId, scoped, userId, dto);
  }

  addViajePagoTransportista(
    tenantId: string | undefined,
    viajeId: string,
    userId: string,
    dto: AddPagoTransportistaDto,
  ) {
    const scoped = this.requiredTenantId(tenantId);
    return this.viajesService.addPagoTransportista(viajeId, scoped, userId, dto);
  }

  deleteViajePagoTransportista(
    tenantId: string | undefined,
    viajeId: string,
    userId: string,
    index: number,
  ) {
    const scoped = this.requiredTenantId(tenantId);
    return this.viajesService.deletePagoTransportista(viajeId, scoped, userId, index);
  }

  micCrtPdf(tenantId: string | undefined, viajeId: string) {
    const scoped = this.requiredTenantId(tenantId);
    return this.micCrt.generate(viajeId, scoped);
  }

  pautPdf(tenantId: string | undefined, viajeId: string) {
    const scoped = this.requiredTenantId(tenantId);
    return this.paut.generate(viajeId, scoped);
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

  async listFacturas(tenantId?: string, clienteId?: string) {
    if (!tenantId?.trim()) return Promise.resolve([]);
    return this.facturacionService.listFacturas(tenantId.trim(), clienteId?.trim() || undefined);
  }

  async updateFactura(tenantId: string | undefined, id: string, dto: UpdateFacturaDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.facturacionService.updateFactura(id, scopedTenantId, dto);
  }

  async createFactura(tenantId: string, dto: CreateFacturaDto) {
    const tid = this.requiredTenantId(tenantId);
    await this.assertTenantExists(tid);
    return this.facturacionService.createFactura(tid, dto);
  }

  async removeFactura(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.facturacionService.removeFactura(id, scopedTenantId);
  }

  async createPago(tenantId: string | undefined, dto: CreatePagoDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.facturacionService.createPago(scopedTenantId, dto);
  }

  async deletePago(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.facturacionService.removePago(id, scopedTenantId);
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

  getEgresoRemitoConfig(tenantId: string | undefined) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.getEgresoRemitoConfig(scopedTenantId);
  }

  upsertEgresoRemitoConfig(tenantId: string | undefined, dto: UpdateStockEgresoRemitoConfigDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.upsertEgresoRemitoConfig(scopedTenantId, dto);
  }

  createEgreso(tenantId: string | undefined, dto: CreateEgresoDto, createdBy: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.createEgreso(scopedTenantId, dto, createdBy);
  }

  listEgresos(tenantId: string | undefined, clienteId?: string, productoId?: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.listEgresos(scopedTenantId, clienteId, productoId);
  }

  listMovimientosStock(
    tenantId: string | undefined,
    productoId?: string,
    clienteId?: string,
    soloIngresoEgreso?: boolean,
  ) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.listMovimientos(scopedTenantId, productoId, clienteId, {
      soloIngresoEgreso: soloIngresoEgreso === true,
    });
  }

  getMovimientoStock(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    return this.stockService.findMovimiento(id, scopedTenantId);
  }

  // ── ARCA (superadmin) ─────────────────────────────────────────────────────

  getArcaConfig(tenantId: string | undefined) {
    const id = this.requiredTenantId(tenantId);
    return this.arcaConfigService.findPublic(id);
  }

  upsertArcaConfig(tenantId: string | undefined, dto: import('../../modules/liquidaciones-arca/dto/upsert-arca-config.dto').UpsertArcaConfigDto) {
    const id = this.requiredTenantId(tenantId);
    return this.arcaConfigService.upsert(id, dto);
  }

  listLiquidaciones(tenantId: string | undefined, estado?: string) {
    const id = this.requiredTenantId(tenantId);
    return this.liquidacionesService.findAll(id, estado);
  }

  getLiquidacion(tenantId: string | undefined, liquidacionId: string) {
    const id = this.requiredTenantId(tenantId);
    return this.liquidacionesService.findById(id, liquidacionId);
  }

  emitirLiquidacion(tenantId: string | undefined, liquidacionId: string) {
    const id = this.requiredTenantId(tenantId);
    return this.liquidacionesService.emitirLiquidacion(id, liquidacionId);
  }

  emitirFacturaArca(
    tenantId: string | undefined,
    facturaId: string,
    dto: import('../../modules/liquidaciones-arca/dto/emitir-factura-arca.dto').EmitirFacturaArcaDto,
  ) {
    const id = this.requiredTenantId(tenantId);
    return this.liquidacionesService.emitirFacturaArca(id, facturaId, dto);
  }

  getArcaLogs(tenantId: string | undefined, liquidacionId?: string, facturaId?: string) {
    const id = this.requiredTenantId(tenantId);
    return this.liquidacionesService.findLogs(id, liquidacionId, facturaId);
  }
}
