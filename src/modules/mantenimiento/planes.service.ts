import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreatePlanMantenimientoDto } from './dto/create-plan-mantenimiento.dto';
import { UpdatePlanMantenimientoDto } from './dto/update-plan-mantenimiento.dto';
import { PlanesQueryDto } from './dto/planes-query.dto';
import { PLANTILLAS_PLAN } from './plantillas-plan.const';

export interface ReglasPlan {
  categoria: string;
  intervaloKm: number | null;
  intervaloDias: number | null;
  avisoKm: number | null;
  avisoDias: number | null;
  tareas: string[];
}

/**
 * Reglas de un plan sobre su estado final (en un PATCH, lo guardado + lo que llega):
 * al menos un intervalo; cada aviso necesita su intervalo y debe ser menor; un plan
 * mecánico necesita al menos una tarea (los documentales pueden no tener).
 */
export function assertReglasPlan(p: ReglasPlan): void {
  if (p.intervaloKm == null && p.intervaloDias == null) {
    throw new BadRequestException('El plan necesita un intervalo en km, en días o ambos.');
  }
  if (p.avisoKm != null) {
    if (p.intervaloKm == null) throw new BadRequestException('El aviso en km necesita un intervalo en km.');
    if (p.avisoKm >= p.intervaloKm) throw new BadRequestException('El aviso en km tiene que ser menor que el intervalo.');
  }
  if (p.avisoDias != null) {
    if (p.intervaloDias == null) throw new BadRequestException('El aviso en días necesita un intervalo en días.');
    if (p.avisoDias >= p.intervaloDias) throw new BadRequestException('El aviso en días tiene que ser menor que el intervalo.');
  }
  if (p.categoria === 'mecanico' && p.tareas.length === 0) {
    throw new BadRequestException('Un plan mecánico necesita al menos una tarea.');
  }
}

const normalizarNombre = (n: string) => n.trim().toLowerCase();

const conVehiculosActivos = {
  _count: { select: { vehiculos: { where: { activo: true } } } },
} satisfies Prisma.PlanMantenimientoInclude;

@Injectable()
export class PlanesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, query: PlanesQueryDto) {
    return this.prisma.planMantenimiento.findMany({
      where: {
        tenantId,
        ...(query.categoria ? { categoria: query.categoria } : {}),
        ...(query.activo !== undefined ? { activo: query.activo === 'true' } : {}),
      },
      include: conVehiculosActivos,
      orderBy: [{ categoria: 'desc' }, { nombre: 'asc' }], // mecánico antes que documental
    });
  }

  async findOne(tenantId: string, id: string) {
    const plan = await this.prisma.planMantenimiento.findFirst({
      where: { id, tenantId },
      include: conVehiculosActivos,
    });
    if (!plan) throw new NotFoundException('Plan de mantenimiento no encontrado');
    return plan;
  }

  private async assertNombreDisponible(tenantId: string, nombre: string, excludeId?: string) {
    const existe = await this.prisma.planMantenimiento.findFirst({
      where: {
        tenantId,
        nombre: { equals: nombre.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existe) throw new ConflictException('Ya existe un plan con ese nombre.');
  }

  async create(tenantId: string, userId: string, dto: CreatePlanMantenimientoDto) {
    const data = {
      nombre: dto.nombre.trim(),
      categoria: dto.categoria,
      tipoVehiculo: dto.tipoVehiculo ?? null,
      intervaloKm: dto.intervaloKm ?? null,
      intervaloDias: dto.intervaloDias ?? null,
      avisoKm: dto.avisoKm ?? null,
      avisoDias: dto.avisoDias ?? null,
      tareas: dto.tareas ?? [],
      activo: dto.activo ?? true,
    };
    assertReglasPlan(data);
    await this.assertNombreDisponible(tenantId, data.nombre);
    return this.prisma.planMantenimiento.create({
      data: { ...data, tenantId, createdBy: userId },
      include: conVehiculosActivos,
    });
  }

  async update(tenantId: string, id: string, dto: UpdatePlanMantenimientoDto) {
    const actual = await this.findOne(tenantId, id);
    const pick = <K extends keyof UpdatePlanMantenimientoDto & keyof typeof actual>(k: K) =>
      dto[k] !== undefined ? dto[k] : actual[k];
    const final = {
      nombre: (dto.nombre ?? actual.nombre).trim(),
      categoria: dto.categoria ?? actual.categoria,
      tipoVehiculo: pick('tipoVehiculo') ?? null,
      intervaloKm: pick('intervaloKm') ?? null,
      intervaloDias: pick('intervaloDias') ?? null,
      avisoKm: pick('avisoKm') ?? null,
      avisoDias: pick('avisoDias') ?? null,
      tareas: dto.tareas ?? actual.tareas,
      activo: dto.activo ?? actual.activo,
    };
    assertReglasPlan(final);
    if (normalizarNombre(final.nombre) !== normalizarNombre(actual.nombre)) {
      await this.assertNombreDisponible(tenantId, final.nombre, id);
    }
    const { count } = await this.prisma.planMantenimiento.updateMany({ where: { id, tenantId }, data: final });
    if (count === 0) throw new NotFoundException('Plan de mantenimiento no encontrado');
    return this.findOne(tenantId, id);
  }

  /**
   * Solo se borra un plan sin unidades asignadas: borrarlo arrastraría en cascada las
   * asignaciones y el vínculo con las OT que lo cumplieron. Si tiene, se desactiva.
   */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const asignaciones = await this.prisma.vehiculoPlan.count({ where: { tenantId, planId: id } });
    if (asignaciones > 0) {
      throw new ConflictException(
        'El plan tiene unidades asignadas (con su historial). Desactivalo en vez de borrarlo.',
      );
    }
    const { count } = await this.prisma.planMantenimiento.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('Plan de mantenimiento no encontrado');
    return { id };
  }

  /**
   * Crea las plantillas sugeridas que el tenant todavía no tiene (por nombre, sin distinguir
   * mayúsculas, contando también los planes inactivos). Si el cliente renombró o borró una,
   * se vuelve a crear con el nombre original.
   */
  async crearPlantillas(tenantId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existentes = await tx.planMantenimiento.findMany({ where: { tenantId }, select: { nombre: true } });
      const nombres = new Set(existentes.map((p) => normalizarNombre(p.nombre)));
      const faltantes = PLANTILLAS_PLAN.filter((t) => !nombres.has(normalizarNombre(t.nombre)));
      if (faltantes.length > 0) {
        await tx.planMantenimiento.createMany({
          data: faltantes.map((t) => ({ ...t, tareas: [...t.tareas], tipoVehiculo: null, tenantId, createdBy: userId })),
        });
      }
      const creados = faltantes.length
        ? await tx.planMantenimiento.findMany({
            where: { tenantId, nombre: { in: faltantes.map((t) => t.nombre) } },
            include: conVehiculosActivos,
            orderBy: { nombre: 'asc' },
          })
        : [];
      return {
        creados,
        existentes: PLANTILLAS_PLAN.filter((t) => nombres.has(normalizarNombre(t.nombre))).map((t) => t.nombre),
      };
    });
  }
}
