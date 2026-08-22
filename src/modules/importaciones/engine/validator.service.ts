import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { StockService } from "../../stock/stock.service";
import type {
  ColumnConfig,
  ParsedRow,
  RowError,
  ValidatedRow,
} from "../types/import.types";

export interface ValidationResult {
  valid: ValidatedRow[];
  errors: RowError[];
  /** Filas válidas con algún campo `warnIfEmpty` vacío (ver import.types.ts). */
  advertencias: { fila: number; campos: string[] }[];
  created: {
    clientes: string[];
    transportistas: string[];
    choferes: string[];
  };
}

@Injectable()
export class ValidatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  async validate(
    rows: ParsedRow[],
    columns: ColumnConfig[],
    tenantId: string,
    readOnly = false,
  ): Promise<ValidationResult> {
    if (rows.length > 0) {
      const excelFields = Object.keys(rows[0]);
      const missingCols = columns.filter(
        (col) => col.required && !excelFields.includes(col.field),
      );
      if (missingCols.length > 0) {
        throw new BadRequestException(
          `Faltan columnas obligatorias en el archivo: ${missingCols.map((c) => c.excelHeader).join(", ")}`,
        );
      }
    }

    // Pre-cargar lookups para evitar N queries por fila
    const { caches, created } = await this.buildLookupCaches(
      rows,
      columns,
      tenantId,
      readOnly,
    );

    const valid: ValidatedRow[] = [];
    const errors: RowError[] = [];
    const advertencias: { fila: number; campos: string[] }[] = [];

    for (const row of rows) {
      const rowErrors: RowError[] = [];
      const rowWarnings: string[] = [];
      const validated: ValidatedRow = {
        _rowNum: row._rowNum,
        _unmappedText: row._unmappedText ?? null,
      };

      for (const col of columns) {
        const raw = row[col.field];
        const result = this.coerce(raw, col, caches, row._rowNum);

        if (result.error) {
          rowErrors.push(result.error);
        } else {
          validated[col.field] = result.value;
          if (result.warning) rowWarnings.push(col.excelHeader);
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
      } else {
        valid.push(validated);
        if (rowWarnings.length > 0) {
          advertencias.push({ fila: row._rowNum, campos: rowWarnings });
        }
      }
    }

    return {
      valid,
      errors,
      advertencias,
      created: {
        clientes: created["clientes"] ?? [],
        transportistas: created["transportistas"] ?? [],
        choferes: created["choferes"] ?? [],
      },
    };
  }

  /**
   * Campos candidatos para un lookup, en orden de prioridad. `lookupFields`
   * (plural) permite matchear contra más de un campo con el mismo valor
   * tipeado (ej. nombre o CUIT) — así un typo en uno no bloquea la fila si
   * el otro campo sí matchea, sin depender de un ID inventado que obligue a
   * saltar entre hojas. Retrocompatible: si solo viene `lookupField`
   * (singular), se usa como único campo.
   */
  private lookupFieldsOf(col: ColumnConfig): string[] {
    if (col.lookupFields?.length) return col.lookupFields;
    return [col.lookupField ?? "nombre"];
  }

  /** Prueba un valor contra cada campo candidato (nombre, después CUIT, etc.) en orden. */
  private lookupOne(
    valor: string,
    model: string,
    fields: string[],
    caches: LookupCaches,
  ): string | null {
    for (const field of fields) {
      const cache = caches[`${model}:${field}`] ?? {};
      const id = cache[valor.toLowerCase()];
      if (id) return id;
    }
    return null;
  }

  private coerce(
    raw: unknown,
    col: ColumnConfig,
    caches: LookupCaches,
    rowNum: number,
  ): { value?: ValidatedRow[string]; error?: RowError; warning?: boolean } {
    const isEmpty = raw == null || String(raw).trim() === "";

    if (isEmpty) {
      if (col.required) {
        return {
          error: {
            fila: rowNum,
            campo: col.excelHeader,
            error: `Campo obligatorio vacío`,
          },
        };
      }
      if (col.defaultValue != null) {
        // Recursamos con el default como si fuera el valor crudo de la celda,
        // así pasa por la misma coerción/validación de tipo que un valor real.
        return this.coerce(col.defaultValue, { ...col, defaultValue: undefined }, caches, rowNum);
      }
      if (col.warnIfEmpty) {
        return { value: null, warning: true };
      }
      return { value: null };
    }

    const str = String(raw).trim();

    switch (col.type) {
      case "string":
        return { value: str };

      case "number": {
        const n = parseFloat(str.replace(",", "."));
        if (isNaN(n)) {
          if (col.required) {
            return {
              error: {
                fila: rowNum,
                campo: col.excelHeader,
                error: `Valor numérico inválido`,
                valor: raw,
              },
            };
          }
          // Campo opcional (ej. "Cond. IVA" con un texto en vez del código
          // AFIP): un valor no numérico no bloquea toda la fila — se deja
          // vacío y se avisa, mismo criterio que un warnIfEmpty vacío.
          return { value: null, warning: true };
        }
        return { value: n };
      }

      case "boolean": {
        const lower = str.toLowerCase();
        if (["si", "sí", "yes", "1", "true", "verdadero"].includes(lower))
          return { value: 1 };
        if (["no", "0", "false", "falso"].includes(lower)) return { value: 0 };
        return {
          error: {
            fila: rowNum,
            campo: col.excelHeader,
            error: `Valor booleano inválido`,
            valor: raw,
          },
        };
      }

      case "date": {
        const date = this.parseDate(raw, col.format);
        if (!date) {
          return {
            error: {
              fila: rowNum,
              campo: col.excelHeader,
              error: `Formato de fecha inválido (esperado: ${col.format ?? "DD/MM/YYYY"})`,
              valor: raw,
            },
          };
        }
        return { value: date };
      }

      case "lookup": {
        const model = col.lookupModel ?? "clientes";

        // ──────────────────────────────────────────────────────────
        // EXCEPCIÓN PARA CIUDADES: Dejamos pasar el texto crudo
        // sin validar contra la base de datos ni bloquear la fila.
        // ──────────────────────────────────────────────────────────
        if ((model as string) === "ciudades") {
          return { value: str };
        }

        const fields = this.lookupFieldsOf(col);

        // multiple: la celda trae varios valores separados (ej. patente de
        // tractor + semirremolido "NPY239/KGA38") — se busca cada uno por
        // separado y el resultado es un array de ids, no uno solo.
        if (col.multiple) {
          const separador = col.separador ?? "/";
          const partes = str
            .split(separador)
            .map((p) => p.trim())
            .filter((p) => p !== "");
          const ids: string[] = [];
          const noEncontrados: { valor: string; posicion: number }[] = [];
          partes.forEach((parte, posicion) => {
            const id = this.lookupOne(parte, model, fields, caches);
            if (id) ids.push(id);
            else noEncontrados.push({ valor: parte, posicion });
          });
          if (noEncontrados.length > 0) {
            return {
              error: {
                fila: rowNum,
                campo: col.excelHeader,
                error: `No se encontró "${noEncontrados.map((n) => n.valor).join(`", "`)}" en ${model}`,
                valor: raw,
                lookupModel: model,
                valoresNoEncontrados: noEncontrados,
              },
            };
          }
          return { value: ids };
        }

        const id = this.lookupOne(str, model, fields, caches);
        if (id) return { value: id };

        return {
          error: {
            fila: rowNum,
            campo: col.excelHeader,
            lookupModel: model,
            valoresNoEncontrados: [{ valor: str, posicion: 0 }],
            error:
              fields.length > 1
                ? `No se encontró "${str}" en ${model} (buscado por ${fields.join(" o ")})`
                : `No se encontró "${str}" en ${model}`,
            valor: raw,
          },
        };
      }

      case "enum": {
        const upper = str.toUpperCase();
        if (!col.allowedValues?.includes(upper)) {
          return {
            error: {
              fila: rowNum,
              campo: col.excelHeader,
              error: `Valor inválido. Los valores permitidos son: ${col.allowedValues?.join(", ")}`,
              valor: raw,
            },
          };
        }
        return { value: upper };
      }

      default:
        return { value: str };
    }
  }

  private parseDate(raw: unknown, format?: string): Date | null {
    // Ya es un Date (xlsx con cellDates:true)
    if (raw instanceof Date) {
      return isNaN(raw.getTime()) ? null : raw;
    }

    const str = String(raw).trim();
    const fmt = (format ?? "DD/MM/YYYY").toUpperCase();

    if (fmt === "DD/MM/YYYY") {
      const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m)
        return new Date(
          `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T00:00:00.000Z`,
        );
    }

    if (fmt === "MM/DD/YYYY") {
      const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m)
        return new Date(
          `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}T00:00:00.000Z`,
        );
    }

    if (fmt === "YYYY-MM-DD") {
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new Date(`${str}T00:00:00.000Z`);
    }

    // Fallback: intentar parseo nativo
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Pre-carga todos los lookups necesarios en un solo pase por las columnas */
  private async buildLookupCaches(
    rows: ParsedRow[],
    columns: ColumnConfig[],
    tenantId: string,
    readOnly = false,
  ): Promise<{ caches: LookupCaches; created: Record<string, string[]> }> {
    const caches: LookupCaches = {};
    const created: Record<string, string[]> = {};

    const lookupCols = columns.filter(
      (c) => c.type === "lookup" && c.lookupModel && (c.lookupModel as string) !== "ciudades",
    );

    // Agrupamos por modelo para consultar una sola vez aunque se busque por
    // varios campos distintos (ej. nombre y CUIT) en la misma entidad.
    const colsByModel = new Map<string, ColumnConfig[]>();
    for (const col of lookupCols) {
      const model = col.lookupModel!;
      const list = colsByModel.get(model) ?? [];
      list.push(col);
      colsByModel.set(model, list);
    }

    for (const [model, cols] of colsByModel) {
      const fieldsSet = new Set<string>();
      for (const col of cols) {
        for (const f of this.lookupFieldsOf(col)) fieldsSet.add(f);
      }
      const fields = [...fieldsSet];

      const records = await this.queryLookup(model, fields, tenantId);

      for (const field of fields) {
        const map: Record<string, string> = {};
        for (const r of records) {
          const v = (r as Record<string, unknown>)[field];
          if (v == null) continue;
          const key = String(v).trim().toLowerCase();
          if (!key) continue;
          map[key] = (r as { id: string }).id;
        }
        caches[`${model}:${field}`] = map;
      }

      // Crear entidades faltantes si alguna columna de este modelo lo permite.
      for (const col of cols) {
        if (!col.createIfNotFound) continue;
        const colFields = this.lookupFieldsOf(col);
        const primaryField = colFields[0];

        const valuesMap = new Map<string, string>(); // lowercase → original
        for (const row of rows) {
          const v = row[col.field];
          if (v != null && String(v).trim()) {
            const original = String(v).trim();
            valuesMap.set(original.toLowerCase(), original);
          }
        }

        for (const [lower, original] of valuesMap) {
          const yaExiste = colFields.some((f) => caches[`${model}:${f}`]?.[lower]);
          if (yaExiste) continue;

          if (readOnly) {
            (created[model] ??= []).push(original);
            (caches[`${model}:${primaryField}`] ??= {})[lower] =
              `__pending__${model}__${original}`;
          } else {
            const id = await this.createLookup(model, primaryField, original, tenantId);
            if (id) {
              (caches[`${model}:${primaryField}`] ??= {})[lower] = id;
              (created[model] ??= []).push(original);
            }
          }
        }
      }
    }

    return { caches, created };
  }

  async createLookup(
    model: string,
    field: string,
    value: string,
    tenantId: string,
  ): Promise<string | null> {
    const nombre = value.trim();
    switch (model) {
      case "clientes": {
        const r = await this.prisma.cliente.create({
          data: { tenantId, nombre },
          select: { id: true },
        });
        return r.id;
      }
      case "transportistas": {
        const r = await this.prisma.transportista.create({
          data: { tenantId, nombre },
          select: { id: true },
        });
        return r.id;
      }
      case "choferes": {
        const r = await this.prisma.chofer.create({
          data: { tenantId, nombre },
          select: { id: true },
        });
        return r.id;
      }
      case "productos": {
        const { id } = await this.stockService.crearProductoSimple(tenantId, nombre);
        return id;
      }
      // 'vehiculos' NO se autocrea: Vehiculo exige patente + tipo, e inventar un
      // tipo por defecto sería exactamente la suposición silenciosa que queremos
      // evitar. queryLookup sí soporta vehiculos, así que la asimetría era una
      // trampa: si alguien pone createIfNotFound=true en VEHICULO, antes esto
      // devolvía null y el vehículo se descartaba sin aviso. Ahora falla claro.
      case "vehiculos":
        throw new BadRequestException(
          "La creación automática de vehículos no está soportada: un vehículo requiere patente y tipo. " +
            'Cargá el vehículo primero, o dejá "createIfNotFound": false en la columna VEHICULO.',
        );
      default:
        throw new BadRequestException(
          `No se puede crear automáticamente un registro en "${model}": modelo no soportado.`,
        );
    }
  }

  /** Consulta un modelo trayendo `id` + todos los campos que hace falta poder matchear. */
  private async queryLookup(
    model: string,
    fields: string[],
    tenantId: string,
  ): Promise<Record<string, unknown>[]> {
    const select: Record<string, boolean> = { id: true };
    for (const f of fields) select[f] = true;

    switch (model) {
      case "clientes":
        return this.prisma.cliente.findMany({ where: { tenantId }, select });
      case "choferes":
        return this.prisma.chofer.findMany({ where: { tenantId }, select });
      case "vehiculos":
        return this.prisma.vehiculo.findMany({ where: { tenantId }, select });
      case "transportistas":
        return this.prisma.transportista.findMany({ where: { tenantId }, select });
      case "productos":
        // Solo activos: un producto inactivo no debe poder vincularse desde el
        // import, mismo criterio que el alta manual (assertProductosAsignables).
        return this.prisma.producto.findMany({
          where: { tenantId, activo: true },
          select,
        });
      default:
        return [];
    }
  }
}

type LookupCaches = Record<string, Record<string, string>>;
