import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OdometroService } from '../../core/odometro/odometro.service';
import { aDiaUtc } from './vencimiento.util';
import { armarHistorial } from './historial.util';
import { NombresUsuariosService } from '../../shared/usuarios/nombres-usuarios.service';

const MS_DIA = 24 * 60 * 60 * 1000;

/** Historial de una unidad: OT + lecturas de km en una sola línea de tiempo (MANT-02-T6). */
@Injectable()
export class HistorialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odometro: OdometroService,
    private readonly nombresUsuarios: NombresUsuariosService,
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
          tareas: true, descripcion: true, fecha: true, createdAt: true, createdBy: true,
          taller: { select: { id: true, nombre: true } },
          planes: { select: { vehiculoPlanId: true, vehiculoPlan: { select: { plan: { select: { nombre: true } } } } } },
          _count: { select: { items: true } },
        },
      }),
      this.odometro.getLecturas(tenantId, vehiculoId, { desde, hasta }),
      this.odometro.getUltimaLectura(tenantId, vehiculoId),
    ]);

    const eventos = armarHistorial(
      ordenes.map(({ planes, _count, createdBy: _c, ...o }) => ({
        ...o,
        planes: planes.map((p) => ({ vehiculoPlanId: p.vehiculoPlanId, planNombre: p.vehiculoPlan.plan.nombre })),
        cantidadItems: _count.items,
      })),
      lecturas,
    );
    const autores = await this.autores(tenantId, ordenes, lecturas);

    return {
      vehiculo,
      odometro: ultima ? { km: ultima.km, fecha: ultima.fecha, fuente: ultima.fuente } : null,
      eventos: eventos.map((e) => ({
        ...e,
        autor: (e.tipo === 'orden' ? autores.get(`orden:${e.orden.id}`) : autores.get(`${e.fuente}:${e.fuenteId}`)) ?? null,
      })),
    };
  }

  /**
   * Quién hizo cada evento, por clave `fuente:id`: OT → `createdBy` (usuario de Vialto o
   * `chofer:<id>` si la cargó el chofer desde la app); carga de combustible → su chofer (o el
   * usuario que la cargó); corrección de km → el usuario. El km del vehículo no tiene autor.
   */
  private async autores(
    tenantId: string,
    ordenes: { id: string; createdBy: string }[],
    lecturas: { fuente: string; fuenteId: string }[],
  ): Promise<Map<string, Autor>> {
    const idsDe = (fuente: string) => lecturas.filter((l) => l.fuente === fuente).map((l) => l.fuenteId);
    const cargaIds = idsDe('carga');
    const edicionIds = idsDe('edicion');
    const choferIds = ordenes.filter((o) => o.createdBy.startsWith('chofer:')).map((o) => o.createdBy.slice(7));

    const [cargas, ediciones, choferes] = await Promise.all([
      cargaIds.length
        ? this.prisma.cargaCombustible.findMany({
            where: { tenantId, id: { in: cargaIds } },
            select: { id: true, createdBy: true, chofer: { select: { nombre: true } } },
          })
        : Promise.resolve([]),
      edicionIds.length
        ? this.prisma.vehiculoKmEdicion.findMany({ where: { tenantId, id: { in: edicionIds } }, select: { id: true, createdBy: true } })
        : Promise.resolve([]),
      choferIds.length
        ? this.prisma.chofer.findMany({ where: { tenantId, id: { in: choferIds } }, select: { id: true, nombre: true } })
        : Promise.resolve([]),
    ]);
    const usuarios = await this.nombresUsuarios.nombres([
      ...ordenes.map((o) => o.createdBy),
      ...cargas.filter((c) => !c.chofer).map((c) => c.createdBy),
      ...ediciones.map((e) => e.createdBy),
    ]);
    const nombreChofer = new Map(choferes.map((c) => [c.id, c.nombre]));
    const usuario = (id: string): Autor | undefined => {
      const nombre = usuarios.get(id);
      return nombre ? { nombre, chofer: false } : undefined;
    };

    const autores = new Map<string, Autor>();
    const poner = (clave: string, autor: Autor | undefined) => autor && autores.set(clave, autor);
    for (const o of ordenes) {
      poner(
        `orden:${o.id}`,
        o.createdBy.startsWith('chofer:')
          ? (n => (n ? { nombre: n, chofer: true } : undefined))(nombreChofer.get(o.createdBy.slice(7)))
          : usuario(o.createdBy),
      );
    }
    for (const c of cargas) poner(`carga:${c.id}`, c.chofer ? { nombre: c.chofer.nombre, chofer: true } : usuario(c.createdBy));
    for (const e of ediciones) poner(`edicion:${e.id}`, usuario(e.createdBy));
    return autores;
  }
}

/** Quién hizo un evento del historial. `chofer` = lo cargó un chofer (app de Combustible). */
export interface Autor {
  nombre: string;
  chofer: boolean;
}
