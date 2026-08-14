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

    const data = {
      dni: (row.dni as string | null)?.toString().trim() || null,
      cuit: (row.cuit as string | null)?.toString().trim() || null,
      licencia: (row.licencia as string | null)?.toString().trim() || null,
      licenciaVence: (row.licenciaVence as Date | null) ?? null,
      telefono: (row.telefono as string | null)?.toString().trim() || null,
      transportistaId: (row.transportistaId as string | null) ?? null,
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
}
