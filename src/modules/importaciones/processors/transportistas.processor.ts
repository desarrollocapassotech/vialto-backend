import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import type { IImportProcessor } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";

@Injectable()
export class TransportistasProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    row: ValidatedRow,
    tenantId: string,
    _createdBy: string,
  ): Promise<string> {
    const nombre = String(row.nombre ?? "").trim();
    if (!nombre) {
      throw new Error("El nombre del transportista es obligatorio.");
    }

    // Campos opcionales: `undefined` (no `null`) cuando la celda viene vacía,
    // para que un reimport no borre datos ya cargados que ese Excel no trae.
    const data = {
      idFiscal: (row.idFiscal as string | null)?.toString().trim() || undefined,
      email: (row.email as string | null)?.toString().trim() || undefined,
      telefono: (row.telefono as string | null)?.toString().trim() || undefined,
      pais: (row.pais as string | null)?.toString().trim() || undefined,
      domicilio: (row.domicilio as string | null)?.toString().trim() || undefined,
      condicionIva:
        row.condicionIva != null ? Number(row.condicionIva) : undefined,
      comisionPct:
        row.comisionPct != null ? Number(row.comisionPct) : undefined,
      paut: (row.paut as string | null)?.toString().trim() || undefined,
      permisoInternacional:
        (row.permisoInternacional as string | null)?.toString().trim() ||
        undefined,
      fechaVencimientoPermiso:
        (row.fechaVencimientoPermiso as Date | null) ?? undefined,
    };

    const existing = await this.prisma.transportista.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.transportista.update({
        where: { id: existing.id },
        data,
      });
      return existing.id;
    }

    const created = await this.prisma.transportista.create({
      data: { tenantId, nombre, ...data },
      select: { id: true },
    });
    return created.id;
  }
}
