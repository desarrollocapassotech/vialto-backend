import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import type { IImportProcessor, InsertResult } from "./import-processor.interface";
import type { CampoUnicoConflicto, ValidatedRow } from "../types/import.types";
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
    const dni = (row.dni as string | null)?.toString().trim() || undefined;

    // El usuario ya eligió "actualizar" este chofer puntual desde el
    // preview (conflicto de DNI resuelto en ImportacionesService.confirm) —
    // se pisa directo el registro que ya tenía ese DNI, incluido el nombre
    // (a diferencia del upsert por nombre de abajo, que lo deja fijo).
    const duplicadoEntidadId =
      typeof row._duplicadoEntidadId === "string" ? row._duplicadoEntidadId : null;
    if (duplicadoEntidadId) {
      const dataActualizar = scalarDataFromRow(row, "Chofer");
      await this.prisma.chofer.update({
        where: { id: duplicadoEntidadId },
        data: dataActualizar,
      });
      return { id: duplicadoEntidadId, creado: false };
    }

    const existing = await this.prisma.chofer.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: "insensitive" } },
      select: { id: true },
    });

    // Mismo criterio que el alta/edición manual (ChoferesService): un DNI no
    // puede pertenecer a dos choferes distintos del mismo tenant. El preview
    // ya detecta este caso (`detectarCampoUnicoDuplicado`) y le hace elegir
    // al usuario ignorar/actualizar antes de confirmar — esto es la red de
    // seguridad final para lo que se cuele sin pasar por esa decisión (ej.
    // dos filas del mismo Excel con igual DNI nuevo).
    if (dni) {
      const duplicado = await this.prisma.chofer.findFirst({
        where: {
          tenantId,
          dni,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { id: true },
      });
      if (duplicado) {
        throw new BadRequestException(`Ya existe otro chofer con el DNI "${dni}"`);
      }
    }

    const data = scalarDataFromRow(row, "Chofer", { skip: ["nombre"] });

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

  /**
   * Filas cuyo DNI ya pertenece a OTRO chofer existente (nombre distinto) —
   * mismo criterio que `ClientesProcessor.detectarCampoUnicoDuplicado`.
   */
  async detectarCampoUnicoDuplicado(
    rows: ValidatedRow[],
    tenantId: string,
  ): Promise<CampoUnicoConflicto[]> {
    const candidatas = rows.filter(
      (r) => typeof r.dni === "string" && r.dni.trim(),
    );
    if (candidatas.length === 0) return [];

    const dnis = [...new Set(candidatas.map((r) => String(r.dni).trim()))];
    const existentes = await this.prisma.chofer.findMany({
      where: { tenantId, dni: { in: dnis } },
      select: { id: true, nombre: true, dni: true },
    });
    const porDni = new Map(existentes.map((e) => [e.dni as string, e]));

    const conflictos: CampoUnicoConflicto[] = [];
    for (const row of candidatas) {
      const dni = String(row.dni).trim();
      const match = porDni.get(dni);
      if (!match) continue;
      const nombreFila = String(row.nombre ?? "").trim().toLowerCase();
      if (match.nombre.trim().toLowerCase() === nombreFila) continue;
      conflictos.push({
        fila: row._rowNum,
        campoLabel: "DNI",
        valor: dni,
        entidadExistenteId: match.id,
        entidadExistenteNombre: match.nombre,
      });
    }
    return conflictos;
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
