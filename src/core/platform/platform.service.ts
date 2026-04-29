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
import { generateNumeroViaje } from '../../modules/viajes/generate-viaje-numero';
import {
  assertViajeOperacionExclusiva,
  mergeViajeOperacionIds,
} from '../../modules/viajes/viaje-operacion-exclusiva';
import {
  assertVehiculosDelViaje,
  idsVehiculosDelViaje,
  normalizarVehiculoIds,
  reemplazarVehiculosDelViaje,
  VIAJE_INCLUDE_VEHICULOS,
  VIAJE_INCLUDE_VEHICULOS_INCLUDE,
  type ViajeConVehiculosViaje,
} from '../../modules/viajes/viaje-vehiculos.helper';
import { UpdateViajeDto } from '../../modules/viajes/dto/update-viaje.dto';
import {
  VIAJE_ESTADOS_SET,
  esEstadoViajeFinal,
  normalizarEstadoViaje,
  type ViajeEstado,
} from '../../modules/viajes/viaje-estados';
import {
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from '../../modules/facturacion/factura-estado-lectura';
import { createClerkClient } from '@clerk/backend';
import { Prisma, $Enums } from '@prisma/client';

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
  constructor(private readonly prisma: PrismaService) {}

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

  private parseEstadoViaje(estado: string): ViajeEstado {
    const n = normalizarEstadoViaje(estado);
    if (!VIAJE_ESTADOS_SET.has(n)) {
      throw new BadRequestException('Estado de viaje inválido');
    }
    return n as ViajeEstado;
  }

  private getMontoFinal(viaje: { monto: number | null }) {
    const monto = viaje.monto;
    if (monto == null || monto <= 0) {
      throw new BadRequestException(
        'Para finalizar un viaje se requiere un monto mayor a 0',
      );
    }
    return monto;
  }

  private async upsertCargoFinalizacion(
    tx: Prisma.TransactionClient,
    viaje: {
      id: string;
      tenantId: string;
      clienteId: string;
      numero: string;
      monto: number | null;
      fechaFinalizado: Date | null;
    },
  ) {
    const monto = this.getMontoFinal(viaje);
    const fecha = viaje.fechaFinalizado ?? new Date();
    const concepto = `Cargo automático por viaje ${viaje.numero}`;
    await tx.movimientoCuentaCorriente.upsert({
      where: {
        tenantId_viajeId: {
          tenantId: viaje.tenantId,
          viajeId: viaje.id,
        },
      },
      update: {
        clienteId: viaje.clienteId,
        tipo: 'cargo',
        origen: 'viaje',
        concepto,
        importe: monto,
        fecha,
        referencia: viaje.numero,
      },
      create: {
        tenantId: viaje.tenantId,
        clienteId: viaje.clienteId,
        viajeId: viaje.id,
        tipo: 'cargo',
        origen: 'viaje',
        concepto,
        importe: monto,
        fecha,
        referencia: viaje.numero,
      },
    });
  }

  private async assertTenantExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { clerkOrgId: tenantId } });
    if (!tenant) throw new BadRequestException('Empresa inválida');
  }

  private async assertViajeRefs(tenantId: string, dto: {
    clienteId: string;
    transportistaId?: string | null;
    choferId?: string | null;
  }) {
    const c = await this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } });
    if (!c) throw new BadRequestException('Cliente inválido para esta empresa');
    if (dto.transportistaId) {
      const t = await this.prisma.transportista.findFirst({
        where: { id: dto.transportistaId, tenantId },
      });
      if (!t) throw new BadRequestException('Transportista inválido');
    }
    if (dto.choferId) {
      const ch = await this.prisma.chofer.findFirst({ where: { id: dto.choferId, tenantId } });
      if (!ch) throw new BadRequestException('Chofer inválido');
    }
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
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId: scopedTenantId },
      include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
    });
    if (!row) throw new NotFoundException('Viaje no encontrado');
    return row as unknown as ViajeConVehiculosViaje;
  }

  async createViaje(
    tenantId: string | undefined,
    dto: CreateViajeDto,
    userId?: string,
  ) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTenantExists(scopedTenantId);
    const transportistaExterno = dto.transportistaId?.trim();
    const vehiculoIds = transportistaExterno
      ? []
      : normalizarVehiculoIds(dto.vehiculoIds);
    assertViajeOperacionExclusiva({
      transportistaId: dto.transportistaId,
      choferId: dto.choferId,
      vehiculoIds,
    });
    const viajeRefs = {
      clienteId: dto.clienteId,
      transportistaId: transportistaExterno || null,
      choferId: transportistaExterno ? null : dto.choferId?.trim() || null,
    };
    await this.assertViajeRefs(scopedTenantId, viajeRefs);
    if (!transportistaExterno) {
      await assertVehiculosDelViaje(this.prisma, scopedTenantId, vehiculoIds, {
        requiereFlotaPropia: true,
      });
    }
    const estado = this.parseEstadoViaje(dto.estado);
    if (esEstadoViajeFinal(estado)) {
      throw new BadRequestException(
        'Un viaje no puede crearse en un estado final',
      );
    }
    const precioTransportistaExterno = dto.precioTransportistaExterno;
    const numero =
      dto.numero?.trim() || (await generateNumeroViaje(this.prisma, scopedTenantId));
    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.ViajeUncheckedCreateInput = {
        tenantId: scopedTenantId,
        numero,
        estado,
        clienteId: dto.clienteId,
        transportistaId: viajeRefs.transportistaId,
        choferId: viajeRefs.choferId,
        origen: dto.origen ?? null,
        destino: dto.destino ?? null,
        fechaCarga: dto.fechaCarga ? new Date(dto.fechaCarga) : null,
        fechaDescarga: dto.fechaDescarga ? new Date(dto.fechaDescarga) : null,
        detalleCarga: dto.detalleCarga ?? null,
        kmRecorridos: dto.kmRecorridos ?? null,
        litrosConsumidos: dto.litrosConsumidos ?? null,
        monto: dto.monto,
        monedaMonto: dto.monedaMonto === 'USD' ? 'USD' : 'ARS',
        precioTransportistaExterno: precioTransportistaExterno ?? null,
        monedaPrecioTransportistaExterno:
          dto.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS',
        observaciones: dto.observaciones ?? null,
        createdBy: userId ?? 'superadmin',
      };
      const viaje = await tx.viaje.create({ data });
      await reemplazarVehiculosDelViaje(tx, viaje.id, vehiculoIds, scopedTenantId);
      const out = await tx.viaje.findFirstOrThrow({
        where: { id: viaje.id },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      });
      return out as unknown as ViajeConVehiculosViaje;
    });
  }

  async updateViaje(tenantId: string | undefined, id: string, dto: UpdateViajeDto) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    const current = await this.getViajeById(scopedTenantId, id);
    const currentIds = idsVehiculosDelViaje(current);
    const op = mergeViajeOperacionIds(
      {
        transportistaId: current.transportistaId,
        choferId: current.choferId,
        vehiculoIds: currentIds,
      },
      dto,
    );
    const mergedRefs = {
      clienteId: dto.clienteId ?? current.clienteId,
      transportistaId: op.transportistaId,
      choferId: op.choferId,
    };
    await this.assertViajeRefs(scopedTenantId, mergedRefs);
    if (!op.transportistaId) {
      await assertVehiculosDelViaje(this.prisma, scopedTenantId, op.vehiculoIds, {
        requiereFlotaPropia: true,
      });
    }
    const precioTransportistaExternoInput = dto.precioTransportistaExterno;
    const currentNorm = this.parseEstadoViaje(
      current.estado != null && String(current.estado).trim() !== ''
        ? String(current.estado)
        : 'pendiente',
    );
    const estadoSiguiente =
      dto.estado != null && String(dto.estado).trim() !== ''
        ? this.parseEstadoViaje(String(dto.estado))
        : currentNorm;

    const data: Prisma.ViajeUpdateInput = {
      ...dto,
      monto:
        dto.monto !== undefined ? dto.monto : current.monto ?? undefined,
      fechaCarga:
        dto.fechaCarga === undefined
          ? undefined
          : dto.fechaCarga
            ? new Date(dto.fechaCarga)
            : null,
      fechaDescarga:
        dto.fechaDescarga === undefined
          ? undefined
          : dto.fechaDescarga
            ? new Date(dto.fechaDescarga)
            : null,
    } as any;
    delete (data as { vehiculoIds?: unknown }).vehiculoIds;
    if (precioTransportistaExternoInput !== undefined) {
      (data as any).precioTransportistaExterno = precioTransportistaExternoInput;
    }
    if (dto.monedaMonto !== undefined) {
      (data as any).monedaMonto = dto.monedaMonto === 'USD' ? 'USD' : 'ARS';
    }
    if (dto.monedaPrecioTransportistaExterno !== undefined) {
      (data as any).monedaPrecioTransportistaExterno =
        dto.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS';
    }
    if (
      !esEstadoViajeFinal(currentNorm) &&
      esEstadoViajeFinal(estadoSiguiente)
    ) {
      data.fechaFinalizado = new Date();
    }

    (data as any).estado = estadoSiguiente;
    (data as any).transportistaId = op.transportistaId;
    (data as any).choferId = op.choferId;

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data,
      });
      await reemplazarVehiculosDelViaje(tx, id, op.vehiculoIds, scopedTenantId);
      const full = (await tx.viaje.findFirstOrThrow({
        where: { id },
        include: VIAJE_INCLUDE_VEHICULOS_INCLUDE,
      })) as unknown as ViajeConVehiculosViaje;
      if (esEstadoViajeFinal(full.estado)) {
        await this.upsertCargoFinalizacion(tx, full);
      }
      return full;
    });
  }

  async removeViaje(tenantId: string | undefined, id: string) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.getViajeById(scopedTenantId, id);
    return this.prisma.viaje.delete({ where: { id } });
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
        cuit: dto.cuit ?? null,
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
        cuit: dto.cuit ?? null,
        email: dto.email ?? null,
        telefono: dto.telefono ?? null,
      },
    });
  }

  async updateTransportista(
    tenantId: string | undefined,
    id: string,
    dto: UpdateTransportistaDto,
  ) {
    const scopedTenantId = this.requiredTenantId(tenantId);
    await this.assertTransportistaExists(scopedTenantId, id);
    return this.prisma.transportista.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        cuit: dto.cuit,
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
    tenantId: string | undefined,
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
        tipo: dto.tipo as $Enums.TipoVehiculo,
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
        tipo: dto.tipo as $Enums.TipoVehiculo | undefined,
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
    tenantId: string | undefined,
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
          ...(data.estado !== undefined ? { estado: data.estado as $Enums.EstadoFactura } : {}),
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
    tenantId: string | undefined,
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
        formaPago: (dto.formaPago ?? null) as $Enums.FormaPago | null,
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
    tenantId: string | undefined,
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
          tipo: dto.tipo as $Enums.TipoFactura,
          clienteId: dto.clienteId ?? null,
          importe: dto.importe ?? 0,
          fechaEmision: new Date(dto.fechaEmision),
          fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
          estado: (dto.estado ?? 'pendiente') as $Enums.EstadoFactura,
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
}
