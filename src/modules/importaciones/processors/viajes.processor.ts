import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { generateNumeroViaje } from '../../viajes/generate-viaje-numero';
import type { IImportProcessor } from './import-processor.interface';
import type { ValidatedRow } from '../types/import.types';

@Injectable()
export class ViajesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(row: ValidatedRow, tenantId: string, createdBy: string): Promise<string> {
    const numero = await generateNumeroViaje(this.prisma, tenantId);

    const observacionesParts: string[] = [];
    if (row.observaciones) observacionesParts.push(row.observaciones as string);
    if (row._unmappedText) observacionesParts.push(row._unmappedText as string);
    const observaciones = observacionesParts.join('\n') || null;

    const clienteId = row.clienteId as string;
    const fechaCarga = (row.fechaCarga as Date | null) ?? null;

    // Determinar estado según fechas
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaDescarga = (row.fechaDescarga as Date | null) ?? null;
    const estado = (() => {
      if (fechaDescarga && fechaDescarga <= hoy) {
        return row.nroFactura ? 'facturado_sin_cobrar' : 'finalizado_sin_facturar';
      }
      if (fechaCarga && fechaCarga <= hoy) return 'en_curso';
      return 'pendiente';
    })();

    // Crear factura del cliente si hay número de factura
    let facturaClienteId: string | null = null;
    if (row.nroFactura) {
      const fechaEmision = (row.fechaEmisionFactura as Date | null) ?? fechaCarga ?? new Date();
      const factura = await this.prisma.factura.create({
        data: {
          tenantId,
          numero: row.nroFactura as string,
          tipo: 'cliente',
          clienteId,
          importe: row.monto != null ? Number(row.monto) : 0,
          fechaEmision,
          fechaVencimiento: (row.fechaVencimientoFactura as Date | null) ?? null,
          estado: 'pendiente',
        },
        select: { id: true },
      });
      facturaClienteId = factura.id;
    }

    const viaje = await this.prisma.viaje.create({
      data: {
        tenantId,
        numero,
        estado,
        clienteId,
        transportistaId: (row.transportistaId as string | null) ?? null,
        choferId: (row.choferId as string | null) ?? null,
        origen: (row.origen as string | null) ?? null,
        destino: (row.destino as string | null) ?? null,
        fechaCarga,
        fechaDescarga,
        detalleCarga: (row.detalleCarga as string | null) ?? null,
        kmRecorridos: row.kmRecorridos != null ? Number(row.kmRecorridos) : null,
        monto: row.monto != null ? Number(row.monto) : null,
        nroFactura: (row.nroFactura as string | null) ?? null,
        precioTransportistaExterno: row.precioTransportistaExterno != null ? Number(row.precioTransportistaExterno) : null,
        facturaId: facturaClienteId,
        observaciones,
        createdBy,
      },
      select: { id: true },
    });

    // Crear factura del transportista externo si hay número de factura
    if (row.nroFacturaTransporte) {
      const fechaEmision = (row.fechaEmisionFacturaTransp as Date | null) ?? fechaCarga ?? new Date();
      await this.prisma.factura.create({
        data: {
          tenantId,
          numero: row.nroFacturaTransporte as string,
          tipo: 'transportista_externo',
          importe: row.precioTransportistaExterno != null ? Number(row.precioTransportistaExterno) : 0,
          fechaEmision,
          fechaVencimiento: (row.fechaVencimientoFacturaTransp as Date | null) ?? null,
          estado: 'pendiente',
        },
      });
    }

    return viaje.id;
  }
}
