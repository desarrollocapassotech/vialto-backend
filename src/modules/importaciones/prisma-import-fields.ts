import { Prisma } from "@prisma/client";
import type { ValidatedRow } from "./types/import.types";

export type PrismaScalarField = {
  name: string;
  type: string;
  isRequired: boolean;
  hasDefaultValue: boolean;
};

const SKIP_SIEMPRE = new Set([
  "id",
  "tenantId",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
]);

/** Campos internos / de sistema que no se importan aunque existan en Prisma. */
export const PRISMA_IMPORT_EXCLUDE: Record<string, ReadonlySet<string>> = {
  Cliente: new Set(),
  Transportista: new Set(["tipo"]),
  Chofer: new Set(["pin", "activo"]),
  Vehiculo: new Set(["activo", "patentePendiente"]),
  Viaje: new Set([
    "numero",
    "estado",
    "etapa",
    "facturacionEstado",
    "liquidacionEstado",
    "facturaId",
    "fechaFinalizado",
    "otrosGastos",
    "pagosTransportista",
    "documentoAduanero",
  ]),
};

export function prismaScalarFields(modelName: string): PrismaScalarField[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) return [];
  const exclude = PRISMA_IMPORT_EXCLUDE[modelName] ?? new Set();
  return model.fields
    .filter(
      (f) =>
        f.kind === "scalar" &&
        f.type !== "Json" &&
        !SKIP_SIEMPRE.has(f.name) &&
        !exclude.has(f.name),
    )
    .map((f) => ({
      name: f.name,
      type: f.type,
      isRequired: f.isRequired,
      hasDefaultValue: f.hasDefaultValue,
    }));
}

export function prismaScalarFieldNames(modelName: string): Set<string> {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) return new Set();
  return new Set(
    model.fields.filter((f) => f.kind === "scalar").map((f) => f.name),
  );
}

function valorParaPrisma(
  raw: unknown,
  prismaType: string | undefined,
): unknown {
  if (raw == null || raw === "") return undefined;
  if (prismaType === "DateTime") {
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw;
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (
    prismaType === "Int" ||
    prismaType === "Float" ||
    prismaType === "Decimal"
  ) {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  if (prismaType === "Boolean") {
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "si" || s === "sí") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return undefined;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    return t === "" ? undefined : t;
  }
  return raw;
}

/**
 * Copia al payload de Prisma los scalars de la fila que existen en el modelo.
 * Celdas vacías se omiten (no pisan datos en un reimport). Campos que no son
 * del modelo (lookups planos, tipoFlota, etc.) se ignoran.
 */
export function scalarDataFromRow(
  row: ValidatedRow,
  modelName: string,
  opts?: { skip?: string[] },
): Record<string, unknown> {
  const allowed = prismaScalarFieldNames(modelName);
  const types = new Map(
    (Prisma.dmmf.datamodel.models.find((m) => m.name === modelName)?.fields ?? [])
      .filter((f) => f.kind === "scalar")
      .map((f) => [f.name, f.type]),
  );
  const skip = new Set([...(opts?.skip ?? []), ...SKIP_SIEMPRE]);
  const exclude = PRISMA_IMPORT_EXCLUDE[modelName] ?? new Set();
  const data: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (key.startsWith("_")) continue;
    if (!allowed.has(key) || skip.has(key) || exclude.has(key)) continue;
    const value = valorParaPrisma(raw, types.get(key));
    if (value === undefined) continue;
    data[key] = value;
  }
  return data;
}
