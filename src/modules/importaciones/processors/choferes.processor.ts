import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import type { IImportProcessor } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";

@Injectable()
export class ChoferesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    row: ValidatedRow,
    tenantId: string,
    _createdBy: string,
  ): Promise<string> {
    const nombre = String(row.nombre ?? "").trim();
    if (!nombre) {
      throw new Error("El nombre del chofer es obligatorio.");
    }

    // Campos opcionales: `undefined` (no `null`) cuando la celda viene vacía,
    // para que un reimport no borre datos ya cargados que ese Excel no trae.
    const data = {
      dni: (row.dni as string | null)?.toString().trim() || undefined,
      cuit: (row.cuit as string | null)?.toString().trim() || undefined,
      licencia: (row.licencia as string | null)?.toString().trim() || undefined,
      licenciaVence: (row.licenciaVence as Date | null) ?? undefined,
      telefono: (row.telefono as string | null)?.toString().trim() || undefined,
      transportistaId: (row.transportistaId as string | null) ?? undefined,
    };

    const existing = await this.prisma.chofer.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.chofer.update({
        where: { id: existing.id },
        data,
      });
      return existing.id;
    }

    const created = await this.prisma.chofer.create({
      data: { tenantId, nombre, ...data },
      select: { id: true },
    });
    return created.id;
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
}
