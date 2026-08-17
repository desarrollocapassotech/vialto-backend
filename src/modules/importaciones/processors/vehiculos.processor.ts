import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { VehiculosService } from "../../../core/vehiculos/vehiculos.service";
import type { IImportProcessor } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";

type CamposComunes = {
  marca?: string;
  modelo?: string;
  anio?: number;
  poliza?: string;
  vencimientoPoliza?: string;
  transportistaId?: string;
};

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

  /** Separa una celda de patente en sus partes (ej. "AC359ES/LHT523" → 2 partes), o [] si viene vacía. */
  private partesPatente(row: ValidatedRow): string[] {
    const raw = (row.patente as string | null)?.toString().trim() || "";
    if (!raw) return [];
    return raw
      .split("/")
      .map((p) => p.trim())
      .filter((p) => p !== "");
  }

  async insert(
    row: ValidatedRow,
    tenantId: string,
    _createdBy: string,
  ): Promise<string> {
    const partes = this.partesPatente(row);
    const tipoFila = String(row.tipo ?? "").trim();
    const campos: CamposComunes = {
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

    // Celda con dos patentes juntas (ej. "AC359ES/LHT523" = tractor +
    // semirremolque, mismo formato que la columna PATENTE de Viajes) — se
    // importan como dos vehículos separados, nunca como uno con una patente
    // compuesta inválida. Orden fijo: primera = tractor, segunda =
    // semirremolque (mismo criterio posicional que usa el import de Viajes
    // para sugerir el tipo de un vehículo faltante).
    if (partes.length >= 2) {
      const tiposPar = ["tractor", "semirremolque"];
      let ultimoId = "";
      for (let i = 0; i < partes.length; i++) {
        const tipo = tiposPar[i] ?? (tipoFila || "otro");
        ultimoId = await this.upsertVehiculo(tenantId, partes[i], tipo, campos);
      }
      return ultimoId;
    }

    if (!tipoFila) {
      throw new Error("El tipo de vehículo es obligatorio.");
    }
    return this.upsertVehiculo(tenantId, partes[0], tipoFila, campos);
  }

  private async upsertVehiculo(
    tenantId: string,
    patente: string | undefined,
    tipo: string,
    campos: CamposComunes,
  ): Promise<string> {
    const dto = { patente, tipo, ...campos };

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

  async contarExistentes(rows: ValidatedRow[], tenantId: string): Promise<number> {
    const existentes = await this.prisma.vehiculo.findMany({
      where: { tenantId },
      select: { patente: true },
    });
    const patentesExistentes = new Set(
      existentes
        .map((v) => v.patente?.trim().toUpperCase())
        .filter((p): p is string => !!p),
    );
    return rows.filter((r) => {
      const partes = this.partesPatente(r);
      return partes.some((p) => patentesExistentes.has(p.toUpperCase()));
    }).length;
  }
}
