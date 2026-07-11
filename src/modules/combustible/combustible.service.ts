import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { CreateCargaDto } from './dto/create-carga.dto';
import { UpdateCargaDto } from './dto/update-carga.dto';
import { CreateCargaChoferDto } from './dto/create-carga-chofer.dto';
import { UpdateCargaChoferDto } from './dto/update-carga-chofer.dto';

/** Datos mínimos de contexto de autenticación que el servicio necesita. */
interface CombustibleAuth {
  tenantId: string | null;
  userId: string;
  role: string | null;
}

@Injectable()
export class CombustibleService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertKmNoRetroceso(
    tenantId: string,
    vehiculoId: string,
    fecha: Date,
    km: number,
    excludeId?: string,
  ) {
    const prev = await this.prisma.cargaCombustible.findFirst({
      where: {
        tenantId,
        vehiculoId,
        fecha: { lt: fecha },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: { fecha: 'desc' },
      select: { km: true, fecha: true },
    });
    if (prev && km < prev.km) {
      const fechaFmt = new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(prev.fecha);
      throw new BadRequestException(
        `KM ingresados son inferiores a los de la carga anterior del vehículo en el ${fechaFmt}`,
      );
    }
  }

  private async assertVehiculoChofer(
    tenantId: string,
    vehiculoId: string,
    choferId?: string | null,
  ) {
    const v = await this.prisma.vehiculo.findFirst({
      where: { id: vehiculoId, tenantId },
    });
    if (!v) throw new BadRequestException('Vehículo inválido');
    if (choferId) {
      const ch = await this.prisma.chofer.findFirst({
        where: { id: choferId, tenantId },
      });
      if (!ch) throw new BadRequestException('Chofer inválido');
    }
  }

  async findAll(
    auth: CombustibleAuth,
    vehiculoId?: string,
    choferId?: string,
    month?: string,
    page = 1,
    limit = 10,
    estacion?: string,
    formaPago?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(200, Math.max(1, limit));

    const where: Record<string, unknown> = { tenantId: auth.tenantId };

    if (auth.role === 'member') {
      where['createdBy'] = auth.userId;
    }

    if (vehiculoId) where['vehiculoId'] = vehiculoId;
    if (choferId) where['choferId'] = choferId;
    if (estacion) where['estacion'] = { contains: estacion, mode: 'insensitive' };
    if (formaPago) where['formaPago'] = formaPago;

    if (month) {
      const [year, mon] = month.split('-').map(Number);
      where['fecha'] = {
        gte: new Date(year, mon - 1, 1),
        lt: new Date(year, mon, 1),
      };
    }

    const [total, cargas] = await Promise.all([
      this.prisma.cargaCombustible.count({ where }),
      this.prisma.cargaCombustible.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        include: {
          vehiculo: { select: { patente: true } },
          chofer: { select: { nombre: true } },
        },
      }),
    ]);

    return { cargas, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, auth: CombustibleAuth) {
    const carga = await this.prisma.cargaCombustible.findFirst({
      where: { id, tenantId: auth.tenantId },
    });
    if (!carga) throw new NotFoundException('Carga no encontrada');
    if (auth.role === 'member' && carga.createdBy !== auth.userId) {
      throw new ForbiddenException('No tenés acceso a esta carga');
    }
    return carga;
  }

  async create(dto: CreateCargaDto, auth: CombustibleAuth) {
    await this.assertVehiculoChofer(auth.tenantId, dto.vehiculoId, dto.choferId);
    return this.prisma.cargaCombustible.create({
      data: {
        tenantId: auth.tenantId,
        vehiculoId: dto.vehiculoId,
        choferId: dto.choferId ?? null,
        estacion: dto.estacion,
        litros: dto.litros,
        precioPorLitro: dto.precioPorLitro,
        importe: dto.importe,
        km: dto.km,
        formaPago: (dto.formaPago ?? null),
        fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
        createdBy: auth.userId,
      },
    });
  }

  async update(id: string, dto: UpdateCargaDto, auth: CombustibleAuth) {
    const carga = await this.findOne(id, auth);
    const nextVehiculo = dto.vehiculoId ?? carga.vehiculoId ?? null;
    const nextChofer =
      dto.choferId === undefined ? carga.choferId : dto.choferId;
    if (nextVehiculo) {
      await this.assertVehiculoChofer(auth.tenantId, nextVehiculo, nextChofer);
    }

    if (auth.role === 'member' && carga.createdBy !== auth.userId) {
      throw new ForbiddenException('No podés editar esta carga');
    }

    return this.prisma.cargaCombustible.update({
      where: { id },
      data: {
        vehiculoId: dto.vehiculoId,
        choferId: dto.choferId,
        estacion: dto.estacion,
        litros: dto.litros,
        precioPorLitro: dto.precioPorLitro,
        importe: dto.importe,
        km: dto.km,
        formaPago: dto.formaPago,
        fecha: dto.fecha === undefined ? undefined : dto.fecha ? new Date(dto.fecha) : undefined,
      },
    });
  }

  async remove(id: string, auth: CombustibleAuth) {
    await this.findOne(id, auth);
    await this.prisma.cargaCombustible.delete({ where: { id } });
    return { deleted: id };
  }

  async findAllByChofer(choferId: string, tenantId: string, month?: string) {
    const where: Record<string, unknown> = { tenantId, choferId };

    if (month) {
      const [year, mon] = month.split('-').map(Number);
      where['fecha'] = {
        gte: new Date(year, mon - 1, 1),
        lt: new Date(year, mon, 1),
      };
    }

    const cargas = await this.prisma.cargaCombustible.findMany({
      where,
      orderBy: { fecha: 'desc' },
      take: 200,
      include: {
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true, dni: true } },
      },
    });

    return { cargas, count: cargas.length };
  }

  async createByChofer(
    dto: CreateCargaChoferDto,
    choferId: string,
    tenantId: string,
  ) {
    const patenteClean = dto.patente.replace(/\s+/g, '').toUpperCase();
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { tenantId, patente: { equals: patenteClean, mode: 'insensitive' } },
    });
    if (!vehiculo) {
      throw new BadRequestException(
        `No se encontró el vehículo con patente "${dto.patente}" en esta empresa`,
      );
    }
    const fechaCarga = dto.fecha ? new Date(dto.fecha) : new Date();
    await this.assertKmNoRetroceso(tenantId, vehiculo.id, fechaCarga, dto.km);
    return this.prisma.cargaCombustible.create({
      data: {
        tenantId,
        vehiculoId: vehiculo.id,
        choferId,
        estacion: dto.estacion,
        litros: dto.litros,
        precioPorLitro: dto.precioPorLitro,
        importe: dto.importe,
        km: dto.km,
        formaPago: dto.formaPago ?? null,
        fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
        createdBy: choferId,
      },
      include: {
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true, dni: true } },
      },
    });
  }

  async getUltimaCargaChofer(choferId: string, tenantId: string) {
    const ultima = await this.prisma.cargaCombustible.findFirst({
      where: { tenantId, choferId },
      orderBy: { fecha: 'desc' },
      include: { vehiculo: { select: { patente: true } } },
    });
    if (!ultima) return null;
    return { patente: ultima.vehiculo?.patente ?? null };
  }

  async getUltimoKmPorPatente(patente: string, tenantId: string, excludeId?: string) {
    const patenteClean = patente.replace(/\s+/g, '').toUpperCase();
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { tenantId, patente: { equals: patenteClean, mode: 'insensitive' } },
    });
    if (!vehiculo) return null;
    const ultima = await this.prisma.cargaCombustible.findFirst({
      where: {
        tenantId,
        vehiculoId: vehiculo.id,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: { fecha: 'desc' },
      select: { km: true, fecha: true },
    });
    if (!ultima) return null;
    return { km: ultima.km, fecha: ultima.fecha.toISOString() };
  }

  async deleteByChofer(id: string, choferId: string, tenantId: string) {
    const carga = await this.prisma.cargaCombustible.findFirst({
      where: { id, tenantId },
    });
    if (!carga) throw new NotFoundException('Carga no encontrada');
    if (carga.choferId !== choferId) {
      throw new ForbiddenException('Solo podés eliminar tus propias cargas');
    }
    await this.prisma.cargaCombustible.delete({ where: { id } });
    return { deleted: id };
  }

  async updateByChofer(
    id: string,
    dto: UpdateCargaChoferDto,
    choferId: string,
    tenantId: string,
  ) {
    const carga = await this.prisma.cargaCombustible.findFirst({
      where: { id, tenantId },
    });
    if (!carga) throw new NotFoundException('Carga no encontrada');
    if (carga.choferId !== choferId) {
      throw new ForbiddenException('Solo podés editar tus propias cargas');
    }

    let vehiculoId: string | undefined = undefined;
    if (dto.patente !== undefined) {
      const patenteClean = dto.patente.replace(/\s+/g, '').toUpperCase();
      const vehiculo = await this.prisma.vehiculo.findFirst({
        where: { tenantId, patente: { equals: patenteClean, mode: 'insensitive' } },
      });
      if (!vehiculo) {
        throw new BadRequestException(
          `No se encontró el vehículo con patente "${dto.patente}" en esta empresa`,
        );
      }
      vehiculoId = vehiculo.id;
    }

    if (dto.km !== undefined) {
      const efectivoVehiculoId = vehiculoId ?? carga.vehiculoId;
      const efectivaFecha = dto.fecha ? new Date(dto.fecha) : carga.fecha;
      if (efectivoVehiculoId) {
        await this.assertKmNoRetroceso(tenantId, efectivoVehiculoId, efectivaFecha, dto.km, id);
      }
    }

    return this.prisma.cargaCombustible.update({
      where: { id },
      data: {
        ...(vehiculoId !== undefined && { vehiculoId }),
        ...(dto.estacion !== undefined && { estacion: dto.estacion }),
        ...(dto.litros !== undefined && { litros: dto.litros }),
        ...(dto.precioPorLitro !== undefined && { precioPorLitro: dto.precioPorLitro }),
        ...(dto.importe !== undefined && { importe: dto.importe }),
        ...(dto.km !== undefined && { km: dto.km }),
        ...(dto.formaPago !== undefined && { formaPago: dto.formaPago }),
        ...(dto.fecha !== undefined && { fecha: new Date(dto.fecha) }),
      },
      include: {
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true, dni: true } },
      },
    });
  }

  async getDashboard(auth: CombustibleAuth, from?: string, to?: string) {
    const where: Record<string, unknown> = { tenantId: auth.tenantId };

    if (from || to) {
      const fechaWhere: Record<string, Date> = {};
      if (from) fechaWhere.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        fechaWhere.lte = toDate;
      }
      where['fecha'] = fechaWhere;
    }

    const [todasCargas, ultimasCargas] = await Promise.all([
      this.prisma.cargaCombustible.findMany({
        where,
        select: { litros: true, importe: true, vehiculoId: true, estacion: true },
      }),
      this.prisma.cargaCombustible.findMany({
        where,
        orderBy: { fecha: 'desc' },
        take: 10,
        select: {
          id: true,
          fecha: true,
          litros: true,
          importe: true,
          km: true,
          estacion: true,
          formaPago: true,
          vehiculo: { select: { patente: true } },
          chofer: { select: { nombre: true } },
        },
      }),
    ]);

    const totalCargas = todasCargas.length;
    const totalLitros = todasCargas.reduce((s, c) => s + c.litros, 0);
    const totalImporte = todasCargas.reduce((s, c) => s + c.importe, 0);
    const precioPorLitro = totalLitros > 0 ? totalImporte / totalLitros : 0;
    const litrosPorCarga = totalCargas > 0 ? totalLitros / totalCargas : 0;

    const estacionMap: Record<string, number> = {};
    for (const c of todasCargas) {
      estacionMap[c.estacion] = (estacionMap[c.estacion] ?? 0) + c.litros;
    }
    const topEstaciones = Object.entries(estacionMap)
      .map(([nombre, litros]) => ({ nombre, litros }))
      .sort((a, b) => b.litros - a.litros)
      .slice(0, 5);

    const vehiculoLitrosMap: Record<string, number> = {};
    for (const c of todasCargas) {
      if (!c.vehiculoId) continue;
      vehiculoLitrosMap[c.vehiculoId] = (vehiculoLitrosMap[c.vehiculoId] ?? 0) + c.litros;
    }
    const vehiculoIds = Object.keys(vehiculoLitrosMap);
    const vehiculos = vehiculoIds.length > 0
      ? await this.prisma.vehiculo.findMany({
          where: { id: { in: vehiculoIds } },
          select: { id: true, patente: true },
        })
      : [];
    const vehiculoMap = new Map(vehiculos.map(v => [v.id, v.patente]));
    const topVehiculos = Object.entries(vehiculoLitrosMap)
      .map(([id, litros]) => ({ patente: vehiculoMap.get(id) ?? id, litros }))
      .sort((a, b) => b.litros - a.litros)
      .slice(0, 5);

    return {
      totalCargas,
      totalLitros,
      totalImporte,
      precioPorLitro,
      litrosPorCarga,
      topEstaciones,
      topVehiculos,
      ultimasCargas,
    };
  }

  async getStats(auth: CombustibleAuth, month?: string) {
    const where: Record<string, unknown> = { tenantId: auth.tenantId };

    if (month) {
      const [year, mon] = month.split('-').map(Number);
      where['fecha'] = {
        gte: new Date(year, mon - 1, 1),
        lt: new Date(year, mon, 1),
      };
    }

    const cargas = await this.prisma.cargaCombustible.findMany({ where });

    const stats = {
      totalCargas: cargas.length,
      totalLitros: cargas.reduce((s, c) => s + c.litros, 0),
      totalImporte: cargas.reduce((s, c) => s + c.importe, 0),
      totalKm: cargas.reduce((s, c) => s + c.km, 0),
      porEstacion: {} as Record<string, number>,
      porFormaPago: {} as Record<string, number>,
    };

    for (const c of cargas) {
      stats.porEstacion[c.estacion] = (stats.porEstacion[c.estacion] ?? 0) + 1;
      if (c.formaPago) {
        stats.porFormaPago[c.formaPago] = (stats.porFormaPago[c.formaPago] ?? 0) + 1;
      }
    }

    return stats;
  }
}
