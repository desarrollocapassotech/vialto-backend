import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OdometroService } from '../../core/odometro/odometro.service';
import { aDiaUtc } from './vencimiento.util';
import { armarHistorial } from './historial.util';

const MS_DIA = 24 * 60 * 60 * 1000;

/** Historial de una unidad: OT + lecturas de km en una sola línea de tiempo (MANT-02-T6). */
@Injectable()
export class HistorialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odometro: OdometroService,
  ) {}

  async historial(tenantId: string, vehiculoId: string, rango: { desde?: string; hasta?: string } = {}) {
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { id: vehiculoId, tenantId },
      select: { id: true, patente: true, tipo: true, marca: true, modelo: true, kmActual: true },
    });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');

    // Rango inclusive por día (las cargas tienen hora: `hasta` llega al final del día).
    const desde = rango.desde ? aDiaUtc(new Date(rango.desde)) : undefined;
    const hasta = rango.hasta ? new Date(aDiaUtc(new Date(rango.hasta)).getTime() + MS_DIA - 1) : undefined;
    const fecha: Prisma.DateTimeFilter | undefined = desde || hasta ? { gte: desde, lte: hasta } : undefined;

    const [ordenes, lecturas, ultima] = await Promise.all([
      this.prisma.ordenTrabajo.findMany({
        where: { tenantId, vehiculoId, ...(fecha ? { fecha } : {}) },
        select: {
          id: true, numero: true, tipo: true, estado: true, km: true, costoTotal: true,
          tareas: true, descripcion: true, fecha: true, createdAt: true,
          taller: { select: { id: true, nombre: true } },
          planes: { select: { vehiculoPlanId: true, vehiculoPlan: { select: { plan: { select: { nombre: true } } } } } },
          _count: { select: { items: true } },
        },
      }),
      this.odometro.getLecturas(tenantId, vehiculoId, { desde, hasta }),
      this.odometro.getUltimaLectura(tenantId, vehiculoId),
    ]);

    const eventos = armarHistorial(
      ordenes.map(({ planes, _count, ...o }) => ({
        ...o,
        planes: planes.map((p) => ({ vehiculoPlanId: p.vehiculoPlanId, planNombre: p.vehiculoPlan.plan.nombre })),
        cantidadItems: _count.items,
      })),
      lecturas,
    );

    return {
      vehiculo,
      odometro: ultima ? { km: ultima.km, fecha: ultima.fecha, fuente: ultima.fuente } : null,
      eventos,
    };
  }
}
