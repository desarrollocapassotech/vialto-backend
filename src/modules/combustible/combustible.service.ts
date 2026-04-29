import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { CreateCargaDto } from './dto/create-carga.dto';
import { UpdateCargaDto } from './dto/update-carga.dto';

@Injectable()
export class CombustibleService {
  constructor(private readonly prisma: PrismaService) {}

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
    auth: AuthPayload,
    vehiculoId?: string,
    choferId?: string,
    month?: string,
  ) {
    const where: Record<string, unknown> = { tenantId: auth.tenantId };

    if (auth.role === 'operador') {
      where['createdBy'] = auth.userId;
    }

    if (vehiculoId) where['vehiculoId'] = vehiculoId;
    if (choferId) where['choferId'] = choferId;

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
    });

    return { cargas, count: cargas.length };
  }

  async findOne(id: string, auth: AuthPayload) {
    const carga = await this.prisma.cargaCombustible.findFirst({
      where: { id, tenantId: auth.tenantId },
    });
    if (!carga) throw new NotFoundException('Carga no encontrada');
    if (auth.role === 'operador' && carga.createdBy !== auth.userId) {
      throw new ForbiddenException('No tenés acceso a esta carga');
    }
    return carga;
  }

  async create(dto: CreateCargaDto, auth: AuthPayload) {
    await this.assertVehiculoChofer(auth.tenantId, dto.vehiculoId, dto.choferId);
    return this.prisma.cargaCombustible.create({
      data: {
        tenantId: auth.tenantId,
        vehiculoId: dto.vehiculoId,
        choferId: dto.choferId ?? null,
        estacion: dto.estacion,
        litros: dto.litros,
        importe: dto.importe,
        km: dto.km,
        formaPago: (dto.formaPago ?? null),
        fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
        createdBy: auth.userId,
      },
    });
  }

  async update(id: string, dto: UpdateCargaDto, auth: AuthPayload) {
    const carga = await this.findOne(id, auth);
    const nextVehiculo = dto.vehiculoId ?? carga.vehiculoId;
    const nextChofer =
      dto.choferId === undefined ? carga.choferId : dto.choferId;
    await this.assertVehiculoChofer(auth.tenantId, nextVehiculo, nextChofer);

    if (auth.role === 'operador' && carga.createdBy !== auth.userId) {
      throw new ForbiddenException('No podés editar esta carga');
    }

    return this.prisma.cargaCombustible.update({
      where: { id },
      data: {
        vehiculoId: dto.vehiculoId,
        choferId: dto.choferId,
        estacion: dto.estacion,
        litros: dto.litros,
        importe: dto.importe,
        km: dto.km,
        formaPago: dto.formaPago,
        fecha: dto.fecha === undefined ? undefined : dto.fecha ? new Date(dto.fecha) : undefined,
      },
    });
  }

  async remove(id: string, auth: AuthPayload) {
    await this.findOne(id, auth);
    await this.prisma.cargaCombustible.delete({ where: { id } });
    return { deleted: id };
  }

  async getStats(auth: AuthPayload, month?: string) {
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
