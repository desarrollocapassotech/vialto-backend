import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import type { IImportProcessor, InsertResult } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";
import { scalarDataFromRow } from "../prisma-import-fields";

@Injectable()
export class ChoferesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    row: ValidatedRow,
    tenantId: string,
    _createdBy: string,
  ): Promise<InsertResult> {
    const nombre = String(row.nombre ?? "").trim();
    if (!nombre) {
      throw new Error("El nombre del chofer es obligatorio.");
    }

    const data = scalarDataFromRow(row, "Chofer", { skip: ["nombre"] });

    const existing = await this.prisma.chofer.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.chofer.update({
        where: { id: existing.id },
        data,
      });
      return { id: existing.id, creado: false };
    }

    const created = await this.prisma.chofer.create({
      data: { tenantId, nombre, ...data },
      select: { id: true },
    });
    return { id: created.id, creado: true };
  }

  async contarExistentes(rows: ValidatedRow[], tenantId: string): Promise<number> {
    const existentes = await this.prisma.chofer.findMany({
      where: { tenantId },
      select: { nombre: true },
    });
    const nombresExistentes = new Set(
      existentes.map((c) => c.nombre.trim().toLowerCase()),
    );
    return rows.filter((r) =>
      nombresExistentes.has(String(r.nombre ?? "").trim().toLowerCase()),
    ).length;
  }

  async filasNuevas(rows: ValidatedRow[], tenantId: string): Promise<Set<number>> {
    const existentes = await this.prisma.chofer.findMany({
      where: { tenantId },
      select: { nombre: true },
    });
    const nombresExistentes = new Set(
      existentes.map((c) => c.nombre.trim().toLowerCase()),
    );
    const nuevas = new Set<number>();
    for (const r of rows) {
      const nombre = String(r.nombre ?? "").trim();
      if (nombre && !nombresExistentes.has(nombre.toLowerCase())) {
        nuevas.add(r._rowNum);
      }
    }
    return nuevas;
  }
}
