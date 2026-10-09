import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OdometroService } from '../../core/odometro/odometro.service';
import type { LecturaKm } from '../../core/odometro/odometro.types';
import { aDiaUtc, type EstadoVencimiento } from './vencimiento.util';
import {
  armarFilaVencimiento,
  elegirUltimaOrden,
  kmHastaElDia,
  ordenarVencimientos,
  resumirVencimientos,
  type FilaVencimiento,
  type OrdenReferencia,
} from './vencimientos.util';

export interface FiltrosVencimientos {
  vehiculoId?: string;
  categoria?: string;
  estado?: EstadoVencimiento;
}

const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * Semáforo de mantenimiento: una fila por plan activo asignado (activo) a una unidad
 * activa, con la referencia del ciclo actual, el odómetro y el resultado de
 * `calcularVencimiento`. Cantidad fija de queries sin importar el tamaño de la flota.
 * Es el único lugar que arma vencimientos: la pantalla, el resumen del dashboard y las
 * notificaciones (MANT-03) lo reusan.
 */
@Injectable()
export class VencimientosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odometro: OdometroService,
  ) {}

  async calcular(tenantId: string, filtros: FiltrosVencimientos = {}, hoy: Date = new Date()): Promise<FilaVencimiento[]> {
    const asignaciones = await this.prisma.vehiculoPlan.findMany({
      where: {
        tenantId,
        activo: true,
        ...(filtros.vehiculoId ? { vehiculoId: filtros.vehiculoId } : {}),
        plan: { tenantId, activo: true, ...(filtros.categoria ? { categoria: filtros.categoria } : {}) },
        vehiculo: { tenantId, activo: true },
      },
      select: {
        id: true,
        baseKm: true,
        baseFecha: true,
        vehiculo: { select: { id: true, patente: true, tipo: true } },
        plan: {
          select: {
            id: true, nombre: true, categoria: true,
            intervaloKm: true, intervaloDias: true, avisoKm: true, avisoDias: true,
            tareas: true,
          },
        },
      },
    });
    if (asignaciones.length === 0) return [];

    // Última OT cerrada que cumple cada asignación (una sola query para todas).
    const cumplidas = await this.prisma.ordenTrabajoPlan.findMany({
      where: {
        tenantId,
        vehiculoPlanId: { in: asignaciones.map((a) => a.id) },
        orden: { tenantId, estado: 'cerrada' },
      },
      select: {
        vehiculoPlanId: true,
        orden: { select: { id: true, numero: true, km: true, fecha: true, createdAt: true } },
      },
    });
    const ordenesPorAsignacion = new Map<string, OrdenReferencia[]>();
    for (const c of cumplidas) {
      const lista = ordenesPorAsignacion.get(c.vehiculoPlanId) ?? [];
      lista.push(c.orden);
      ordenesPorAsignacion.set(c.vehiculoPlanId, lista);
    }
    const ultimaPorAsignacion = new Map(
      asignaciones.map((a) => [a.id, elegirUltimaOrden(ordenesPorAsignacion.get(a.id) ?? [])]),
    );

    // OT sin km → km del odómetro a la fecha de la OT (solo si hace falta).
    const asignacionesSinKm = asignaciones.filter((a) => ultimaPorAsignacion.get(a.id)?.km === null);
    let lecturasSinKm = new Map<string, LecturaKm[]>();
    if (asignacionesSinKm.length > 0) {
      const fechaMax = Math.max(
        ...asignacionesSinKm.map((a) => (ultimaPorAsignacion.get(a.id) as OrdenReferencia).fecha.getTime()),
      );
      lecturasSinKm = await this.odometro.getLecturasMuchos(
        tenantId,
        asignacionesSinKm.map((a) => a.vehiculo.id),
        { hasta: new Date(aDiaUtc(new Date(fechaMax)).getTime() + MS_DIA - 1) },
      );
    }

    const vehiculoIds = [...new Set(asignaciones.map((a) => a.vehiculo.id))];
    const [ultimas, kmPorDia] = await Promise.all([
      this.odometro.getUltimasLecturas(tenantId, vehiculoIds),
      this.odometro.getKmPorDiaMuchos(tenantId, vehiculoIds, hoy),
    ]);

    const hoyDia = aDiaUtc(hoy);
    const filas = asignaciones.map((a) => {
      const ultimaOrden = ultimaPorAsignacion.get(a.id) ?? null;
      const kmOdometroALaFechaDeLaOrden =
        ultimaOrden && ultimaOrden.km === null ? kmHastaElDia(lecturasSinKm.get(a.vehiculo.id) ?? [], ultimaOrden.fecha) : null;
      return armarFilaVencimiento({
        asignacion: { vehiculoPlanId: a.id, vehiculo: a.vehiculo, plan: a.plan, baseKm: a.baseKm, baseFecha: a.baseFecha },
        ultimaOrden,
        kmOdometroALaFechaDeLaOrden,
        odometro: ultimas.get(a.vehiculo.id) ?? null,
        kmPorDia: kmPorDia.get(a.vehiculo.id) ?? null,
        hoy: hoyDia,
      });
    });

    const filtradas = filtros.estado ? filas.filter((f) => f.estado === filtros.estado) : filas;
    return ordenarVencimientos(filtradas);
  }

  async resumen(tenantId: string, hoy: Date = new Date()) {
    return resumirVencimientos(await this.calcular(tenantId, {}, hoy));
  }
}
