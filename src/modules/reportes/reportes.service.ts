import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

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
