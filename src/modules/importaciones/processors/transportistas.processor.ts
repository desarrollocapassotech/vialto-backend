import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { validarIdFiscal } from "../../../shared/util/validar-id-fiscal";
import type { IImportProcessor, InsertResult } from "./import-processor.interface";
import type { CampoUnicoConflicto, ValidatedRow } from "../types/import.types";
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

    // El usuario ya eligió "actualizar" este transportista puntual desde el
    // preview (conflicto de ID Fiscal resuelto en ImportacionesService.confirm)
    // — se pisa directo el registro que ya tenía ese CUIT, incluido el
    // nombre (a diferencia del upsert por nombre de abajo, que lo deja fijo).
    const duplicadoEntidadId =
      typeof row._duplicadoEntidadId === "string" ? row._duplicadoEntidadId : null;
    if (duplicadoEntidadId) {
      const dataActualizar = scalarDataFromRow(row, "Transportista");
      await this.prisma.transportista.update({
        where: { id: duplicadoEntidadId },
        data: dataActualizar,
      });
      return { id: duplicadoEntidadId, creado: false };
    }

    const existing = await this.prisma.transportista.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: "insensitive" } },
      select: { id: true },
    });

    // Mismo criterio que el alta/edición manual (TransportistasService): un
    // CUIT no puede pertenecer a dos transportistas distintos del mismo
    // tenant. El preview ya detecta este caso (`detectarCampoUnicoDuplicado`)
    // y le hace elegir al usuario ignorar/actualizar antes de confirmar —
    // esto es la red de seguridad final para lo que se cuele sin pasar por
    // esa decisión (ej. dos filas del mismo Excel con igual CUIT nuevo).
    if (idFiscal) {
      const duplicado = await this.prisma.transportista.findFirst({
        where: {
          tenantId,
          idFiscal,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { id: true },
      });
      if (duplicado) {
        throw new BadRequestException(
          `Ya existe otro transportista con el ID Fiscal "${idFiscal}"`,
        );
      }
    }

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

  /**
   * Filas cuyo ID Fiscal ya pertenece a OTRO transportista existente (nombre
   * distinto) — mismo criterio que `ClientesProcessor.detectarCampoUnicoDuplicado`.
   */
  async detectarCampoUnicoDuplicado(
    rows: ValidatedRow[],
    tenantId: string,
  ): Promise<CampoUnicoConflicto[]> {
    const candidatas = rows.filter(
      (r) => typeof r.idFiscal === "string" && r.idFiscal.trim(),
    );
    if (candidatas.length === 0) return [];

    const idFiscales = [
      ...new Set(candidatas.map((r) => String(r.idFiscal).trim())),
    ];
    const existentes = await this.prisma.transportista.findMany({
      where: { tenantId, idFiscal: { in: idFiscales } },
      select: { id: true, nombre: true, idFiscal: true },
    });
    const porIdFiscal = new Map(
      existentes.map((e) => [e.idFiscal as string, e]),
    );

    const conflictos: CampoUnicoConflicto[] = [];
    for (const row of candidatas) {
      const idFiscal = String(row.idFiscal).trim();
      const match = porIdFiscal.get(idFiscal);
      if (!match) continue;
      const nombreFila = String(row.nombre ?? "").trim().toLowerCase();
      if (match.nombre.trim().toLowerCase() === nombreFila) continue;
      conflictos.push({
        fila: row._rowNum,
        campoLabel: "ID Fiscal",
        valor: idFiscal,
        entidadExistenteId: match.id,
        entidadExistenteNombre: match.nombre,
      });
    }
    return conflictos;
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
