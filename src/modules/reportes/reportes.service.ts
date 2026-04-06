import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { VIAJE_ESTADOS_FINALES } from '../viajes/viaje-estados';

@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  private getMonthRanges() {
    const now = new Date();
    const startMesActual = new Date(now.getFullYear(), now.getMonth(), 1);
    const startMesSiguiente = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startMesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { startMesActual, startMesSiguiente, startMesAnterior };
  }

  async tableroGeneral(tenantId: string, horasEnCurso = 48) {
    const horas = Number.isFinite(horasEnCurso) && horasEnCurso > 0 ? horasEnCurso : 48;
    const umbralEnCurso = new Date(Date.now() - horas * 60 * 60 * 1000);
    const { startMesActual, startMesSiguiente, startMesAnterior } = this.getMonthRanges();

    const [clientes, resumenMovimientos, viajesFinalizadosSinCargo, viajesEnCursoLargos, facturadoMesActual, facturadoMesAnterior] =
      await Promise.all([
        this.prisma.cliente.findMany({
          where: { tenantId },
          select: { id: true, nombre: true },
        }),
        this.prisma.movimientoCuentaCorriente.groupBy({
          by: ['clienteId', 'tipo'],
          where: { tenantId },
          _sum: { importe: true },
        }),
        this.prisma.viaje.findMany({
          where: {
            tenantId,
            estado: 'finalizado_sin_facturar',
            movimientosCuentaCorriente: {
              none: {
                tipo: 'cargo',
                origen: 'viaje',
              },
            },
          },
          orderBy: { fechaFinalizado: 'desc' },
          select: {
            id: true,
            numero: true,
            clienteId: true,
            monto: true,
            fechaFinalizado: true,
          },
        }),
        this.prisma.viaje.findMany({
          where: {
            tenantId,
            estado: 'en_curso',
            OR: [
              { fechaCarga: { lte: umbralEnCurso } },
              { fechaCarga: null, createdAt: { lte: umbralEnCurso } },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            numero: true,
            clienteId: true,
            origen: true,
            destino: true,
            fechaCarga: true,
            createdAt: true,
          },
        }),
        this.prisma.viaje.aggregate({
          where: {
            tenantId,
            estado: { in: [...VIAJE_ESTADOS_FINALES] },
            fechaFinalizado: {
              gte: startMesActual,
              lt: startMesSiguiente,
            },
          },
          _sum: { monto: true },
        }),
        this.prisma.viaje.aggregate({
          where: {
            tenantId,
            estado: { in: [...VIAJE_ESTADOS_FINALES] },
            fechaFinalizado: {
              gte: startMesAnterior,
              lt: startMesActual,
            },
          },
          _sum: { monto: true },
        }),
      ]);

    const nombreCliente = new Map(clientes.map((c) => [c.id, c.nombre]));
    const saldoCliente = new Map<string, number>();
    for (const row of resumenMovimientos) {
      const actual = saldoCliente.get(row.clienteId) ?? 0;
      const valor = row._sum.importe ?? 0;
      const signed = row.tipo === 'cargo' ? valor : -valor;
      saldoCliente.set(row.clienteId, actual + signed);
    }

    const deudores = [...saldoCliente.entries()]
      .filter(([, saldo]) => saldo > 0)
      .map(([clienteId, saldo]) => ({
        clienteId,
        clienteNombre: nombreCliente.get(clienteId) ?? 'Cliente',
        saldo: -saldo,
        deuda: saldo,
      }))
      .sort((a, b) => b.deuda - a.deuda);

    return {
      tenantId,
      configuracion: {
        horasEnCurso: horas,
      },
      deudores,
      inconsistencias: {
        viajesFinalizadosSinCargo,
      },
      alertasOperativas: {
        viajesEnCursoHaceMasDeXHoras: viajesEnCursoLargos,
      },
      facturacion: {
        mesActual: facturadoMesActual._sum.monto ?? 0,
        mesAnterior: facturadoMesAnterior._sum.monto ?? 0,
      },
    };
  }

  async resumen(tenantId: string) {
    const [
      viajes,
      facturas,
      movimientosCc,
      productos,
      movimientosStock,
      cargasCombustible,
      intervenciones,
      remitos,
    ] = await Promise.all([
      this.prisma.viaje.count({ where: { tenantId } }),
      this.prisma.factura.count({ where: { tenantId } }),
      this.prisma.movimientoCuentaCorriente.count({ where: { tenantId } }),
      this.prisma.producto.count({ where: { tenantId } }),
      this.prisma.movimientoStock.count({ where: { tenantId } }),
      this.prisma.cargaCombustible.count({ where: { tenantId } }),
      this.prisma.intervencion.count({ where: { tenantId } }),
      this.prisma.remito.count({ where: { tenantId } }),
    ]);

    return {
      tenantId,
      conteos: {
        viajes,
        facturas,
        movimientosCuentaCorriente: movimientosCc,
        productos,
        movimientosStock,
        cargasCombustible,
        intervenciones,
        remitos,
      },
    };
  }
}
