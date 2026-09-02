import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { VehiculosService } from "../../../core/vehiculos/vehiculos.service";
import type { IImportProcessor, InsertResult } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";
import { scalarDataFromRow } from "../prisma-import-fields";

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

  private camposComunes(row: ValidatedRow): Record<string, unknown> {
    const campos = scalarDataFromRow(row, "Vehiculo", {
      skip: ["patente", "tipo"],
    });
    // CreateVehiculoDto espera ISO date string, no Date.
    if (campos.vencimientoPoliza instanceof Date) {
      campos.vencimientoPoliza = campos.vencimientoPoliza
        .toISOString()
        .slice(0, 10);
    }
    return campos;
  }

  async insert(
    row: ValidatedRow,
    tenantId: string,
    _createdBy: string,
  ): Promise<InsertResult> {
    const partes = this.partesPatente(row);
    const tipoFila = String(row.tipo ?? "").trim();
    const campos = this.camposComunes(row);

    // Celda con dos patentes juntas (ej. "AC359ES/LHT523" = tractor +
    // semirremolque, mismo formato que la columna PATENTE de Viajes) — se
    // importan como dos vehículos separados, nunca como uno con una patente
    // compuesta inválida. Orden fijo: primera = tractor, segunda =
    // semirremolque (mismo criterio posicional que usa el import de Viajes
    // para sugerir el tipo de un vehículo faltante).
    if (partes.length >= 2) {
      const tiposPar = ["tractor", "semirremolque"];
      let ultimo: InsertResult = { id: "", creado: false };
      for (let i = 0; i < partes.length; i++) {
        const tipo = tiposPar[i] ?? (tipoFila || "otro");
        const resultado = await this.upsertVehiculo(
          tenantId,
          partes[i],
          tipo,
          campos,
        );
        // Si cualquiera de los dos es alta nueva, la fila cuenta como
        // "creado" en el resumen — es una aproximación razonable para una
        // fila que en realidad puede tocar dos vehículos distintos.
        ultimo = { id: resultado.id, creado: ultimo.creado || resultado.creado };
      }
      return ultimo;
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
    campos: Record<string, unknown>,
  ): Promise<InsertResult> {
    const dto = { patente, tipo, ...campos };

    if (patente) {
      const existing = await this.prisma.vehiculo.findFirst({
        where: { tenantId, patente: patente.toUpperCase() },
        select: { id: true },
      });
      if (existing) {
        await this.vehiculosService.update(existing.id, tenantId, dto);
        return { id: existing.id, creado: false };
      }
    }

    const created = await this.vehiculosService.create(tenantId, dto);
    return { id: created.id, creado: true };
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

  async filasNuevas(rows: ValidatedRow[], tenantId: string): Promise<Set<number>> {
    const existentes = await this.prisma.vehiculo.findMany({
      where: { tenantId },
      select: { patente: true },
    });
    const patentesExistentes = new Set(
      existentes
        .map((v) => v.patente?.trim().toUpperCase())
        .filter((p): p is string => !!p),
    );
    // Fila "nueva" si CUALQUIERA de sus patentes (tractor y/o semirremolque,
    // ver `partesPatente`) todavía no existe — mismo criterio que ya usa
    // `insert()` para decidir si la fila cuenta como alta en el resumen.
    const nuevas = new Set<number>();
    for (const r of rows) {
      const partes = this.partesPatente(r);
      if (partes.some((p) => !patentesExistentes.has(p.toUpperCase()))) {
        nuevas.add(r._rowNum);
      }
    }
    return nuevas;
  }
}
