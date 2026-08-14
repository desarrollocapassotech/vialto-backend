import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { validarIdFiscal } from "../../../shared/util/validar-id-fiscal";
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
    const idFiscal = (row.idFiscal as string | null)?.toString().trim() || undefined;
    const pais = (row.pais as string | null)?.toString().trim() || undefined;
    // No-op si falta alguno de los dos: solo valida formato cuando hay algo que validar.
    validarIdFiscal(pais, idFiscal);

    const existing = await this.prisma.transportista.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: "insensitive" } },
      select: { id: true },
    });

    // Igual que el alta manual: un transportista nuevo necesita país e ID
    // Fiscal sí o sí. En un reimport que solo actualiza otros campos, si ya
    // los tenía cargados no hace falta repetirlos en la fila.
    if (!existing && (!idFiscal || !pais)) {
      throw new Error(
        "Un transportista nuevo requiere país e ID Fiscal (igual que el alta manual).",
      );
    }

    // Campos opcionales: `undefined` (no `null`) cuando la celda viene vacía,
    // para que un reimport no borre datos ya cargados que ese Excel no trae.
    const data = {
      idFiscal,
      email: (row.email as string | null)?.toString().trim() || undefined,
      telefono: (row.telefono as string | null)?.toString().trim() || undefined,
      pais,
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
