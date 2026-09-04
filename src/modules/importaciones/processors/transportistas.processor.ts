import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { validarIdFiscal } from "../../../shared/util/validar-id-fiscal";
import type { IImportProcessor, InsertResult } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";
import { scalarDataFromRow } from "../prisma-import-fields";

@Injectable()
export class TransportistasProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    row: ValidatedRow,
    tenantId: string,
    _createdBy: string,
  ): Promise<InsertResult> {
    const nombre = String(row.nombre ?? "").trim();
    if (!nombre) {
      throw new Error("El nombre del transportista es obligatorio.");
    }
    const idFiscal = (row.idFiscal as string | null)?.toString().trim() || undefined;
    const pais = (row.pais as string | null)?.toString().trim() || undefined;
    // No-op si falta alguno de los dos: solo valida formato cuando hay algo que validar.
    validarIdFiscal(pais, idFiscal);

    const existing = await this.prisma.transportista.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: "insensitive" } },
      select: { id: true },
    });

    // País e ID Fiscal son recomendados (warnIfEmpty en el template), no
    // obligatorios: si llegamos hasta acá con alguno vacío, el usuario ya
    // confirmó explícitamente que quiere importar igual (ver
    // ImportacionesService.confirm).

    const data = scalarDataFromRow(row, "Transportista", { skip: ["nombre"] });

    if (existing) {
      await this.prisma.transportista.update({
        where: { id: existing.id },
        data,
      });
      return { id: existing.id, creado: false };
    }

    const created = await this.prisma.transportista.create({
      data: { tenantId, nombre, ...data },
      select: { id: true },
    });
    return { id: created.id, creado: true };
  }

  async contarExistentes(rows: ValidatedRow[], tenantId: string): Promise<number> {
    const existentes = await this.prisma.transportista.findMany({
      where: { tenantId },
      select: { nombre: true },
    });
    const nombresExistentes = new Set(
      existentes.map((t) => t.nombre.trim().toLowerCase()),
    );
    return rows.filter((r) =>
      nombresExistentes.has(String(r.nombre ?? "").trim().toLowerCase()),
    ).length;
  }

  async filasNuevas(rows: ValidatedRow[], tenantId: string): Promise<Set<number>> {
    const existentes = await this.prisma.transportista.findMany({
      where: { tenantId },
      select: { nombre: true },
    });
    const nombresExistentes = new Set(
      existentes.map((t) => t.nombre.trim().toLowerCase()),
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
