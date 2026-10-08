import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AsignarVehiculosDto } from './dto/asignar-vehiculos.dto';
import { UpdateVehiculoPlanDto } from './dto/update-vehiculo-plan.dto';
import { aDiaUtc } from './vencimiento.util';

/** Base de una unidad: `undefined` = no vino (no se toca), `null` = se borra. */
interface BaseVehiculo {
  vehiculoId: string;
  baseKm?: number | null;
  baseFecha?: Date | null;
}

const conVehiculo = {
  vehiculo: { select: { id: true, patente: true, tipo: true } },
} satisfies Prisma.VehiculoPlanInclude;

/**
 * Fecha del último service conocido: se guarda como día en UTC y no puede ser futura.
 * `undefined` y `null` pasan tal cual (no vino / se borra).
 */
export function parseBaseFecha(valor: string | null | undefined, hoy: Date = new Date()): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const fecha = aDiaUtc(new Date(valor));
  if (Number.isNaN(fecha.getTime())) throw new BadRequestException('La fecha del último service no es válida.');
  if (fecha.getTime() > aDiaUtc(hoy).getTime()) {
    throw new BadRequestException('La fecha del último service no puede ser futura (es la fecha del último service hecho).');
  }
  return fecha;
}

function datosBase(b: BaseVehiculo): { baseKm?: number | null; baseFecha?: Date | null } {
  return {
    ...(b.baseKm !== undefined ? { baseKm: b.baseKm } : {}),
    ...(b.baseFecha !== undefined ? { baseFecha: b.baseFecha } : {}),
  };
}

@Injectable()
export class AsignacionesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normaliza las dos formas del DTO a una lista de bases por unidad. */
  private bases(dto: AsignarVehiculosDto, hoy: Date): BaseVehiculo[] {
    const comun = dto.vehiculoIds !== undefined;
    const porVehiculo = dto.vehiculos !== undefined;
    if (comun === porVehiculo) {
      throw new BadRequestException('Mandá `vehiculoIds` (base común) o `vehiculos` (base por unidad), una de las dos.');
    }
    const lista: BaseVehiculo[] = comun
      ? (dto.vehiculoIds as string[]).map((vehiculoId) => ({
          vehiculoId,
          baseKm: dto.baseKm,
          baseFecha: parseBaseFecha(dto.baseFecha, hoy),
        }))
      : (dto.vehiculos ?? []).map((v) => ({
          vehiculoId: v.vehiculoId,
          baseKm: v.baseKm,
          baseFecha: parseBaseFecha(v.baseFecha, hoy),
        }));
    if (new Set(lista.map((b) => b.vehiculoId)).size !== lista.length) {
      throw new BadRequestException('Hay unidades repetidas en el pedido.');
    }
    return lista;
  }

  private async planActivo(tenantId: string, planId: string) {
    const plan = await this.prisma.planMantenimiento.findFirst({
      where: { id: planId, tenantId },
      select: { id: true, activo: true },
    });
    if (!plan) throw new NotFoundException('Plan de mantenimiento no encontrado');
    if (!plan.activo) throw new BadRequestException('El plan está desactivado. Activalo antes de asignarlo.');
    return plan;
  }

  /**
   * Alta masiva del plan en varias unidades. Activas ya asignadas → se ignoran (no se toca
   * su base); inactivas → se reactivan (con la base nueva si vino); el resto se crea.
   */
  async asignar(tenantId: string, planId: string, dto: AsignarVehiculosDto, hoy: Date = new Date()) {
    const bases = this.bases(dto, hoy);
    await this.planActivo(tenantId, planId);

    const ids = bases.map((b) => b.vehiculoId);
    const vehiculos = await this.prisma.vehiculo.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
    const validos = new Set(vehiculos.map((v) => v.id));
    const invalidos = ids.filter((id) => !validos.has(id));
    if (invalidos.length > 0) {
      throw new BadRequestException(`Hay unidades que no existen en esta empresa: ${invalidos.join(', ')}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const existentes = await tx.vehiculoPlan.findMany({
        where: { tenantId, planId, vehiculoId: { in: ids } },
        select: { id: true, vehiculoId: true, activo: true },
      });
      const porVehiculo = new Map(existentes.map((e) => [e.vehiculoId, e]));

      const yaAsignados: string[] = [];
      const reactivarIds: string[] = [];
      const nuevas: BaseVehiculo[] = [];
      for (const b of bases) {
        const e = porVehiculo.get(b.vehiculoId);
        if (!e) {
          nuevas.push(b);
        } else if (e.activo) {
          yaAsignados.push(b.vehiculoId);
        } else {
          await tx.vehiculoPlan.updateMany({
            where: { id: e.id, tenantId },
            data: { activo: true, ...datosBase(b) },
          });
          reactivarIds.push(e.id);
        }
      }

      if (nuevas.length > 0) {
        await tx.vehiculoPlan.createMany({
          data: nuevas.map((b) => ({
            tenantId,
            planId,
            vehiculoId: b.vehiculoId,
            baseKm: b.baseKm ?? null,
            baseFecha: b.baseFecha ?? null,
          })),
          skipDuplicates: true,
        });
      }

      const [creados, reactivados] = await Promise.all([
        nuevas.length
          ? tx.vehiculoPlan.findMany({
              where: { tenantId, planId, vehiculoId: { in: nuevas.map((b) => b.vehiculoId) } },
              include: conVehiculo,
            })
          : Promise.resolve([]),
        reactivarIds.length
          ? tx.vehiculoPlan.findMany({ where: { tenantId, id: { in: reactivarIds } }, include: conVehiculo })
          : Promise.resolve([]),
      ]);
      return { creados, reactivados, yaAsignados };
    });
  }

  /** Asignaciones de un plan (activas e inactivas), por patente. */
  async listarPorPlan(tenantId: string, planId: string) {
    const plan = await this.prisma.planMantenimiento.findFirst({ where: { id: planId, tenantId }, select: { id: true } });
    if (!plan) throw new NotFoundException('Plan de mantenimiento no encontrado');
    return this.prisma.vehiculoPlan.findMany({
      where: { tenantId, planId },
      include: conVehiculo,
      orderBy: { vehiculo: { patente: 'asc' } },
    });
  }

  /** Planes asignados a una unidad (activos e inactivos), con los datos del plan. */
  async listarPorVehiculo(tenantId: string, vehiculoId: string) {
    const vehiculo = await this.prisma.vehiculo.findFirst({ where: { id: vehiculoId, tenantId }, select: { id: true } });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');
    return this.prisma.vehiculoPlan.findMany({
      where: { tenantId, vehiculoId },
      include: { plan: true },
      orderBy: { plan: { nombre: 'asc' } },
    });
  }

  private async findOne(tenantId: string, id: string) {
    const vp = await this.prisma.vehiculoPlan.findFirst({ where: { id, tenantId }, include: conVehiculo });
    if (!vp) throw new NotFoundException('Asignación no encontrada');
    return vp;
  }

  async update(tenantId: string, id: string, dto: UpdateVehiculoPlanDto, hoy: Date = new Date()) {
    await this.findOne(tenantId, id);
    const data = {
      ...datosBase({ vehiculoId: '', baseKm: dto.baseKm, baseFecha: parseBaseFecha(dto.baseFecha, hoy) }),
      ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
    };
    const { count } = await this.prisma.vehiculoPlan.updateMany({ where: { id, tenantId }, data });
    if (count === 0) throw new NotFoundException('Asignación no encontrada');
    return this.findOne(tenantId, id);
  }

  /** Solo se borra si ninguna OT la cumplió (si no, se perdería ese vínculo): en ese caso, desactivar. */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const ordenes = await this.prisma.ordenTrabajoPlan.count({ where: { tenantId, vehiculoPlanId: id } });
    if (ordenes > 0) {
      throw new ConflictException('Hay órdenes de trabajo que cumplieron esta asignación. Desactivala en vez de borrarla.');
    }
    const { count } = await this.prisma.vehiculoPlan.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('Asignación no encontrada');
    return { id };
  }
}
