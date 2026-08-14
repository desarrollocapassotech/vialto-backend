import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { VehiculosService } from "../../../core/vehiculos/vehiculos.service";
import type { IImportProcessor } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";

/**
 * Reutiliza VehiculosService (no reimplementa la generación de patente
 * placeholder) para que alta manual e import no diverjan — ver
 * VehiculosService#createConPatentePendiente.
 */
@Injectable()
export class VehiculosProcessor implements IImportProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehiculosService: VehiculosService,
  ) {}

  async insert(
    row: ValidatedRow,
    tenantId: string,
    _createdBy: string,
  ): Promise<string> {
    const tipo = String(row.tipo ?? "").trim();
    if (!tipo) {
      throw new Error("El tipo de vehículo es obligatorio.");
    }
    const patente = (row.patente as string | null)?.toString().trim() || undefined;

    const dto = {
      patente,
      tipo,
      marca: (row.marca as string | null)?.toString().trim() || undefined,
      modelo: (row.modelo as string | null)?.toString().trim() || undefined,
      anio: row.anio != null ? Number(row.anio) : undefined,
      poliza: (row.poliza as string | null)?.toString().trim() || undefined,
      vencimientoPoliza:
        row.vencimientoPoliza instanceof Date
          ? row.vencimientoPoliza.toISOString().slice(0, 10)
          : undefined,
      transportistaId: (row.transportistaId as string | null) ?? undefined,
    };

    if (patente) {
      const existing = await this.prisma.vehiculo.findFirst({
        where: { tenantId, patente: patente.toUpperCase() },
        select: { id: true },
      });
      if (existing) {
        await this.vehiculosService.update(existing.id, tenantId, dto);
        return existing.id;
      }
    }

    const created = await this.vehiculosService.create(tenantId, dto);
    return created.id;
  }
}
