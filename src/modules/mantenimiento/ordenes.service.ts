import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';
import { OdometroService } from '../../core/odometro/odometro.service';
import { CreateOrdenTrabajoDto } from './dto/create-orden-trabajo.dto';
import { UpdateOrdenTrabajoDto } from './dto/update-orden-trabajo.dto';
import { OrdenesQueryDto } from './dto/ordenes-query.dto';
import { calcularItems, evaluarKmOrden } from './ordenes.util';
import { aDiaUtc } from './vencimiento.util';

const detalleOrden = {
  vehiculo: { select: { id: true, patente: true, tipo: true } },
  taller: { select: { id: true, nombre: true } },
  items: { orderBy: { id: 'asc' } },
  planes: {
    select: {
      vehiculoPlanId: true,
      vehiculoPlan: { select: { id: true, planId: true, plan: { select: { id: true, nombre: true, categoria: true } } } },
    },
  },
} satisfies Prisma.OrdenTrabajoInclude;

const resumenOrden = {
  vehiculo: { select: { id: true, patente: true, tipo: true } },
  taller: { select: { id: true, nombre: true } },
  _count: { select: { items: true, planes: true } },
} satisfies Prisma.OrdenTrabajoInclude;

@Injectable()
export class OrdenesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly odometro: OdometroService,
  ) {}

  // ── Lectura ──────────────────────────────────────────────────────────────

  async findAllPaginated(tenantId: string, query: OrdenesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const fecha: Prisma.DateTimeFilter = {};
    if (query.desde) fecha.gte = aDiaUtc(new Date(query.desde));
    if (query.hasta) fecha.lte = aDiaUtc(new Date(query.hasta));
    const where: Prisma.OrdenTrabajoWhereInput = {
      tenantId,
      ...(query.vehiculoId ? { vehiculoId: query.vehiculoId } : {}),
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...(query.tallerId ? { tallerId: query.tallerId } : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(query.desde || query.hasta ? { fecha } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.ordenTrabajo.count({ where }),
      this.prisma.ordenTrabajo.findMany({
        where,
        include: resumenOrden,
        orderBy: [{ fecha: 'desc' }, { numero: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items,
      meta: { page, pageSize, total, totalPages, hasPrev: page > 1, hasNext: page < totalPages },
    };
  }

  async findOne(tenantId: string, id: string) {
    const orden = await this.prisma.ordenTrabajo.findFirst({ where: { id, tenantId }, include: detalleOrden });
    if (!orden) throw new NotFoundException('Orden de trabajo no encontrada');
    return orden;
  }

  // ── Validaciones ─────────────────────────────────────────────────────────

  private async assertVehiculo(tenantId: string, vehiculoId: string) {
    const v = await this.prisma.vehiculo.findFirst({ where: { id: vehiculoId, tenantId }, select: { id: true } });
    if (!v) throw new BadRequestException('La unidad no existe en esta empresa.');
  }

  private async assertTaller(tenantId: string, tallerId: string | null | undefined) {
    if (!tallerId) return;
    const t = await this.prisma.taller.findFirst({ where: { id: tallerId, tenantId }, select: { activo: true } });
    if (!t) throw new BadRequestException('El taller no existe en esta empresa.');
    if (!t.activo) throw new BadRequestException('El taller está desactivado.');
  }

  /** Cada asignación tiene que ser del tenant y de la misma unidad que la OT. */
  private async assertPlanesDelVehiculo(tenantId: string, vehiculoId: string, vehiculoPlanIds: string[]) {
    if (vehiculoPlanIds.length === 0) return;
    const encontrados = await this.prisma.vehiculoPlan.findMany({
      where: { tenantId, id: { in: vehiculoPlanIds }, vehiculoId },
      select: { id: true },
    });
    if (encontrados.length !== vehiculoPlanIds.length) {
      throw new BadRequestException('Hay planes que no están asignados a esta unidad.');
    }
  }

  private assertAdjuntos(tenantId: string, adjuntos: string[] | undefined) {
    for (const url of adjuntos ?? []) {
      if (!this.cloudinary.esAdjuntoMantenimientoDelTenant(url, tenantId)) {
        throw new BadRequestException('Hay un adjunto que no se subió por Vialto. Subilo de nuevo.');
      }
    }
  }

  private async nextNumeroTx(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const id = randomUUID().replace(/-/g, '').slice(0, 25);
    const rows = await tx.$queryRaw<{ lastValue: number }[]>(
      Prisma.sql`
        INSERT INTO "orden_trabajo_secuencias" ("id", "tenantId", "lastValue")
        VALUES (${id}, ${tenantId}, 1)
        ON CONFLICT ("tenantId")
        DO UPDATE SET "lastValue" = "orden_trabajo_secuencias"."lastValue" + 1
        RETURNING "lastValue"
      `,
    );
    const n = rows[0]?.lastValue;
    if (n === undefined || n === null) throw new BadRequestException('No se pudo generar el número de la orden.');
    return Number(n);
  }

  /** Aviso no bloqueante si el km no cierra con las lecturas vecinas del odómetro. */
  private async warningKm(
    tenantId: string,
    orden: { id: string; vehiculoId: string; km: number | null; fecha: Date; createdAt: Date },
  ): Promise<string | null> {
    if (orden.km === null) return null;
    const lecturas = (await this.odometro.getLecturas(tenantId, orden.vehiculoId)).filter((l) => l.fuenteId !== orden.id);
    return evaluarKmOrden(orden, lecturas);
  }

  // ── Escritura ────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateOrdenTrabajoDto) {
    const vehiculoPlanIds = dto.vehiculoPlanIds ?? [];
    await this.assertVehiculo(tenantId, dto.vehiculoId);
    await this.assertTaller(tenantId, dto.tallerId);
    await this.assertPlanesDelVehiculo(tenantId, dto.vehiculoId, vehiculoPlanIds);
    this.assertAdjuntos(tenantId, dto.adjuntos);
    const { items, costoTotal } = calcularItems(dto.items);

    const id = await this.prisma.$transaction(async (tx) => {
      const numero = await this.nextNumeroTx(tx, tenantId);
      const orden = await tx.ordenTrabajo.create({
        data: {
          tenantId,
          numero,
          vehiculoId: dto.vehiculoId,
          tipo: dto.tipo,
          origen: vehiculoPlanIds.length > 0 ? 'plan' : 'manual',
          estado: 'cerrada',
          tallerId: dto.tallerId ?? null,
          fecha: aDiaUtc(new Date(dto.fecha)),
          km: dto.km ?? null,
          tareas: dto.tareas ?? [],
          descripcion: dto.descripcion || null,
          costoTotal,
          adjuntos: dto.adjuntos ?? [],
          createdBy: userId,
        },
        select: { id: true },
      });
      if (items.length > 0) {
        await tx.ordenTrabajoItem.createMany({ data: items.map((i) => ({ ...i, tenantId, ordenId: orden.id })) });
      }
      if (vehiculoPlanIds.length > 0) {
        await tx.ordenTrabajoPlan.createMany({
          data: vehiculoPlanIds.map((vehiculoPlanId) => ({ tenantId, ordenId: orden.id, vehiculoPlanId })),
        });
      }
      return orden.id;
    });

    const orden = await this.findOne(tenantId, id);
    return { ...orden, warning: await this.warningKm(tenantId, orden) };
  }

  async update(tenantId: string, id: string, dto: UpdateOrdenTrabajoDto) {
    const actual = await this.findOne(tenantId, id);
    if (actual.estado === 'anulada') throw new ConflictException('La orden está anulada y no se puede editar.');

    const vehiculoId = dto.vehiculoId ?? actual.vehiculoId;
    if (dto.vehiculoId !== undefined && dto.vehiculoId !== actual.vehiculoId) {
      await this.assertVehiculo(tenantId, vehiculoId);
    }
    if (dto.tallerId !== undefined && dto.tallerId !== actual.tallerId) {
      await this.assertTaller(tenantId, dto.tallerId);
    }
    const planesFinales = dto.vehiculoPlanIds ?? actual.planes.map((p) => p.vehiculoPlanId);
    if (dto.vehiculoPlanIds !== undefined || vehiculoId !== actual.vehiculoId) {
      try {
        await this.assertPlanesDelVehiculo(tenantId, vehiculoId, planesFinales);
      } catch (e) {
        if (dto.vehiculoPlanIds === undefined) {
          throw new BadRequestException(
            'La orden cumple planes de la unidad anterior. Mandá `vehiculoPlanIds` de la unidad nueva (o vacío).',
          );
        }
        throw e;
      }
    }
    if (dto.adjuntos !== undefined) this.assertAdjuntos(tenantId, dto.adjuntos);
    const calculo = dto.items !== undefined ? calcularItems(dto.items) : null;

    const data: Prisma.OrdenTrabajoUncheckedUpdateManyInput = {
      ...(dto.vehiculoId !== undefined ? { vehiculoId } : {}),
      ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
      ...(dto.tallerId !== undefined ? { tallerId: dto.tallerId || null } : {}),
      ...(dto.fecha !== undefined ? { fecha: aDiaUtc(new Date(dto.fecha)) } : {}),
      ...(dto.km !== undefined ? { km: dto.km } : {}),
      ...(dto.tareas !== undefined ? { tareas: dto.tareas } : {}),
      ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion || null } : {}),
      ...(dto.adjuntos !== undefined ? { adjuntos: dto.adjuntos } : {}),
      ...(calculo ? { costoTotal: calculo.costoTotal } : {}),
      origen: planesFinales.length > 0 ? 'plan' : 'manual',
    };

    await this.prisma.$transaction(async (tx) => {
      // Primero los planes: si cambia la unidad, el trigger exige que los que queden sean de la nueva.
      if (dto.vehiculoPlanIds !== undefined) {
        await tx.ordenTrabajoPlan.deleteMany({ where: { tenantId, ordenId: id } });
      }
      const { count } = await tx.ordenTrabajo.updateMany({ where: { id, tenantId }, data });
      if (count === 0) throw new NotFoundException('Orden de trabajo no encontrada');
      if (dto.vehiculoPlanIds !== undefined && planesFinales.length > 0) {
        await tx.ordenTrabajoPlan.createMany({
          data: planesFinales.map((vehiculoPlanId) => ({ tenantId, ordenId: id, vehiculoPlanId })),
        });
      }
      if (calculo) {
        await tx.ordenTrabajoItem.deleteMany({ where: { tenantId, ordenId: id } });
        if (calculo.items.length > 0) {
          await tx.ordenTrabajoItem.createMany({ data: calculo.items.map((i) => ({ ...i, tenantId, ordenId: id })) });
        }
      }
    });

    const orden = await this.findOne(tenantId, id);
    return { ...orden, warning: await this.warningKm(tenantId, orden) };
  }

  /** Anula la OT: deja de contar como lectura de km y como referencia de los planes que cumplía. */
  async anular(tenantId: string, id: string) {
    const actual = await this.findOne(tenantId, id);
    if (actual.estado === 'anulada') return actual;
    const { count } = await this.prisma.ordenTrabajo.updateMany({ where: { id, tenantId }, data: { estado: 'anulada' } });
    if (count === 0) throw new NotFoundException('Orden de trabajo no encontrada');
    return this.findOne(tenantId, id);
  }

  /** Solo se borra una OT que no cumple planes; si cumple, se anula (queda el historial). */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const planes = await this.prisma.ordenTrabajoPlan.count({ where: { tenantId, ordenId: id } });
    if (planes > 0) throw new ConflictException('La orden cumple planes de mantenimiento. Anulala en vez de borrarla.');
    const { count } = await this.prisma.ordenTrabajo.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('Orden de trabajo no encontrada');
    return { id };
  }

  async subirAdjunto(tenantId: string, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Se requiere un archivo.');
    const esPdf = file.mimetype === 'application/pdf' || file.originalname?.toLowerCase().endsWith('.pdf');
    if (!esPdf && !file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('El adjunto tiene que ser un PDF o una imagen.');
    }
    const url = await this.cloudinary.uploadMantenimientoAdjunto(tenantId, file.buffer, file.originalname, file.mimetype);
    return { url };
  }
}
