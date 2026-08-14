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

    const data = {
      idFiscal: (row.idFiscal as string | null)?.toString().trim() || null,
      email: (row.email as string | null)?.toString().trim() || null,
      telefono: (row.telefono as string | null)?.toString().trim() || null,
      pais: (row.pais as string | null)?.toString().trim() || null,
      domicilio: (row.domicilio as string | null)?.toString().trim() || null,
      condicionIva:
        row.condicionIva != null ? Number(row.condicionIva) : null,
      comisionPct: row.comisionPct != null ? Number(row.comisionPct) : null,
      paut: (row.paut as string | null)?.toString().trim() || null,
      permisoInternacional:
        (row.permisoInternacional as string | null)?.toString().trim() ||
        null,
      fechaVencimientoPermiso:
        (row.fechaVencimientoPermiso as Date | null) ?? null,
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
