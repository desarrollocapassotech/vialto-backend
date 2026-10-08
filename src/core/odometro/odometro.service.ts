import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { LecturaKm, RangoLecturas } from './odometro.types';
import {
  KM_POR_DIA_VENTANA_DIAS,
  calcularKmPorDia,
  ordenarLecturas,
  ultimaLectura,
} from './odometro.util';

type FiltroFecha = { gte?: Date; lte?: Date };

/**
 * Odómetro de la flota: servicio de SOLO LECTURA que une las fuentes de km existentes
 * (cargas de combustible no sospechosas, correcciones manuales y órdenes de trabajo
 * cerradas). No tiene tabla propia y es el único lugar donde Mantenimiento (y a futuro el
 * CPK) lee km. Solo lee tablas con Prisma: no depende del código de ningún módulo.
 * No participa de la validación de km de Combustible (`assertKmNoRetroceso`).
 */
@Injectable()
export class OdometroService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lecturas de un vehículo, en orden cronológico (ver `compararLecturas`). */
  async getLecturas(tenantId: string, vehiculoId: string, rango: RangoLecturas = {}): Promise<LecturaKm[]> {
    const fecha: FiltroFecha | undefined =
      rango.desde || rango.hasta ? { gte: rango.desde, lte: rango.hasta } : undefined;
    const porVehiculo = await this.lecturasPorVehiculo(tenantId, [vehiculoId], fecha);
    return ordenarLecturas(porVehiculo.get(vehiculoId) ?? []);
  }

  /** Lecturas de varios vehículos (3 queries en total), cada lista en orden cronológico. */
  async getLecturasMuchos(
    tenantId: string,
    vehiculoIds: string[],
    rango: RangoLecturas = {},
  ): Promise<Map<string, LecturaKm[]>> {
    const ids = [...new Set(vehiculoIds)];
    if (ids.length === 0) return new Map();
    const fecha: FiltroFecha | undefined =
      rango.desde || rango.hasta ? { gte: rango.desde, lte: rango.hasta } : undefined;
    const porVehiculo = await this.lecturasPorVehiculo(tenantId, ids, fecha);
    for (const [id, lecturas] of porVehiculo) porVehiculo.set(id, ordenarLecturas(lecturas));
    return porVehiculo;
  }

  /** Lectura más reciente; sin lecturas usa `Vehiculo.kmActual` (fuente `'vehiculo'`). */
  async getUltimaLectura(tenantId: string, vehiculoId: string): Promise<LecturaKm | null> {
    const m = await this.getUltimasLecturas(tenantId, [vehiculoId]);
    return m.get(vehiculoId) ?? null;
  }

  async getKmPorDia(tenantId: string, vehiculoId: string, hoy: Date = new Date()): Promise<number | null> {
    const m = await this.getKmPorDiaMuchos(tenantId, [vehiculoId], hoy);
    return m.get(vehiculoId) ?? null;
  }

  /**
   * Última lectura de varios vehículos en pocas queries (una por fuente + el fallback),
   * para listados como los vencimientos de todo un tenant. Un vehículo que no existe o es
   * de otro tenant no aparece en el Map.
   */
  async getUltimasLecturas(tenantId: string, vehiculoIds: string[]): Promise<Map<string, LecturaKm>> {
    const ids = [...new Set(vehiculoIds)];
    const resultado = new Map<string, LecturaKm>();
    if (ids.length === 0) return resultado;

    // Una candidata por fuente y vehículo (la última de cada una); después se elige entre
    // esas con el criterio de mismo día de `compararLecturas`.
    const candidatas = await this.lecturasPorVehiculo(tenantId, ids, undefined, true);
    for (const [vehiculoId, lecturas] of candidatas) {
      const ultima = ultimaLectura(lecturas);
      if (ultima) resultado.set(vehiculoId, ultima);
    }

    const sinLecturas = ids.filter((id) => !resultado.has(id));
    if (sinLecturas.length > 0) {
      const vehiculos = await this.prisma.vehiculo.findMany({
        where: { tenantId, id: { in: sinLecturas } },
        select: { id: true, kmActual: true, createdAt: true },
      });
      for (const v of vehiculos) {
        resultado.set(v.id, {
          km: v.kmActual,
          fecha: v.createdAt,
          fuente: 'vehiculo',
          fuenteId: v.id,
          createdAt: v.createdAt,
        });
      }
    }
    return resultado;
  }

  /** Km/día de varios vehículos con las lecturas de los últimos 60 días (3 queries en total). */
  async getKmPorDiaMuchos(
    tenantId: string,
    vehiculoIds: string[],
    hoy: Date = new Date(),
  ): Promise<Map<string, number | null>> {
    const ids = [...new Set(vehiculoIds)];
    const resultado = new Map<string, number | null>();
    if (ids.length === 0) return resultado;

    const desde = new Date(hoy.getTime() - KM_POR_DIA_VENTANA_DIAS * 24 * 60 * 60 * 1000);
    const porVehiculo = await this.lecturasPorVehiculo(tenantId, ids, { gte: desde, lte: hoy });
    for (const id of ids) {
      resultado.set(id, calcularKmPorDia(porVehiculo.get(id) ?? [], hoy));
    }
    return resultado;
  }

  /**
   * Trae las lecturas de las 3 fuentes para los vehículos pedidos, agrupadas por vehículo.
   * Con `soloUltimaPorFuente`, cada fuente devuelve solo su lectura más reciente por vehículo.
   */
  private async lecturasPorVehiculo(
    tenantId: string,
    vehiculoIds: string[],
    fecha?: FiltroFecha,
    soloUltimaPorFuente = false,
  ): Promise<Map<string, LecturaKm[]>> {
    // `distinct` + orden descendente = la lectura más reciente de cada fuente por vehículo.
    const distinct = soloUltimaPorFuente ? (['vehiculoId'] as const) : undefined;
    const orderBy = soloUltimaPorFuente
      ? [{ vehiculoId: 'asc' as const }, { fecha: 'desc' as const }, { createdAt: 'desc' as const }]
      : undefined;
    const fechaWhere = fecha ? { fecha } : {};

    const [cargas, ediciones, ordenes] = await Promise.all([
      this.prisma.cargaCombustible.findMany({
        where: { tenantId, vehiculoId: { in: vehiculoIds }, sospechoso: false, ...fechaWhere },
        select: { id: true, vehiculoId: true, km: true, fecha: true, createdAt: true },
        distinct: distinct ? [...distinct] : undefined,
        orderBy,
      }),
      this.prisma.vehiculoKmEdicion.findMany({
        where: { tenantId, vehiculoId: { in: vehiculoIds }, ...fechaWhere },
        select: { id: true, vehiculoId: true, kmNuevo: true, fecha: true, createdAt: true },
        distinct: distinct ? [...distinct] : undefined,
        orderBy,
      }),
      this.prisma.ordenTrabajo.findMany({
        where: { tenantId, vehiculoId: { in: vehiculoIds }, estado: 'cerrada', km: { not: null }, ...fechaWhere },
        select: { id: true, vehiculoId: true, km: true, fecha: true, createdAt: true },
        distinct: distinct ? [...distinct] : undefined,
        orderBy,
      }),
    ]);

    const porVehiculo = new Map<string, LecturaKm[]>();
    const agregar = (vehiculoId: string | null, lectura: LecturaKm) => {
      if (!vehiculoId) return;
      const lista = porVehiculo.get(vehiculoId);
      if (lista) lista.push(lectura);
      else porVehiculo.set(vehiculoId, [lectura]);
    };
    for (const c of cargas) {
      agregar(c.vehiculoId, { km: c.km, fecha: c.fecha, fuente: 'carga', fuenteId: c.id, createdAt: c.createdAt });
    }
    for (const e of ediciones) {
      agregar(e.vehiculoId, { km: e.kmNuevo, fecha: e.fecha, fuente: 'edicion', fuenteId: e.id, createdAt: e.createdAt });
    }
    for (const o of ordenes) {
      if (o.km === null) continue;
      agregar(o.vehiculoId, { km: o.km, fecha: o.fecha, fuente: 'orden_trabajo', fuenteId: o.id, createdAt: o.createdAt });
    }
    return porVehiculo;
  }
}
