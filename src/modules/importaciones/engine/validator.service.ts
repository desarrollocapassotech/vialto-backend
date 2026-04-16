import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type {
  ColumnConfig,
  ParsedRow,
  RowError,
  ValidatedRow,
} from '../types/import.types';

export interface ValidationResult {
  valid: ValidatedRow[];
  errors: RowError[];
  created: {
    clientes: string[];
    transportistas: string[];
    choferes: string[];
  };
}

@Injectable()
export class ValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(
    rows: ParsedRow[],
    columns: ColumnConfig[],
    tenantId: string,
  ): Promise<ValidationResult> {
    // Pre-cargar lookups para evitar N queries por fila
    const { caches, created } = await this.buildLookupCaches(rows, columns, tenantId);

    const valid: ValidatedRow[] = [];
    const errors: RowError[] = [];

    for (const row of rows) {
      const rowErrors: RowError[] = [];
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
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
      } else {
        valid.push(validated);
      }
    }

    return {
      valid,
      errors,
      created: {
        clientes: created['clientes'] ?? [],
        transportistas: created['transportistas'] ?? [],
        choferes: created['choferes'] ?? [],
      },
    };
  }

  private coerce(
    raw: unknown,
    col: ColumnConfig,
    caches: LookupCaches,
    rowNum: number,
  ): { value: ValidatedRow[string]; error?: undefined } | { value?: undefined; error: RowError } {
    const isEmpty = raw == null || String(raw).trim() === '';

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
      return { value: null };
    }

    const str = String(raw).trim();

    switch (col.type) {
      case 'string':
        return { value: str };

      case 'number': {
        const n = parseFloat(str.replace(',', '.'));
        if (isNaN(n)) {
          return {
            error: { fila: rowNum, campo: col.excelHeader, error: `Valor numérico inválido`, valor: raw },
          };
        }
        return { value: n };
      }

      case 'boolean': {
        const lower = str.toLowerCase();
        if (['si', 'sí', 'yes', '1', 'true', 'verdadero'].includes(lower)) return { value: 1 };
        if (['no', '0', 'false', 'falso'].includes(lower)) return { value: 0 };
        return {
          error: { fila: rowNum, campo: col.excelHeader, error: `Valor booleano inválido`, valor: raw },
        };
      }

      case 'date': {
        const date = this.parseDate(raw, col.format);
        if (!date) {
          return {
            error: {
              fila: rowNum,
              campo: col.excelHeader,
              error: `Formato de fecha inválido (esperado: ${col.format ?? 'DD/MM/YYYY'})`,
              valor: raw,
            },
          };
        }
        return { value: date };
      }

      case 'lookup': {
        const model = col.lookupModel ?? 'clientes';
        const field = col.lookupField ?? 'nombre';
        const cacheKey = `${model}:${field}`;
        const cache = caches[cacheKey] ?? {};
        const id = cache[str.toLowerCase()];
        if (!id) {
          return {
            error: {
              fila: rowNum,
              campo: col.excelHeader,
              error: `No se encontró "${str}" en ${model}`,
              valor: raw,
            },
          };
        }
        return { value: id };
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
    const fmt = (format ?? 'DD/MM/YYYY').toUpperCase();

    if (fmt === 'DD/MM/YYYY') {
      const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00.000Z`);
    }

    if (fmt === 'MM/DD/YYYY') {
      const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return new Date(`${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T00:00:00.000Z`);
    }

    if (fmt === 'YYYY-MM-DD') {
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
  ): Promise<{ caches: LookupCaches; created: Record<string, string[]> }> {
    const caches: LookupCaches = {};
    const created: Record<string, string[]> = {};

    const lookupCols = columns.filter((c) => c.type === 'lookup' && c.lookupModel);

    for (const col of lookupCols) {
      const model = col.lookupModel!;
      const field = col.lookupField ?? 'nombre';
      const cacheKey = `${model}:${field}`;

      if (caches[cacheKey]) continue;

      // Recolectar valores únicos preservando el texto original (casing del Excel)
      const valuesMap = new Map<string, string>(); // lowercase → original
      for (const row of rows) {
        const v = row[col.field];
        if (v != null && String(v).trim()) {
          const original = String(v).trim();
          valuesMap.set(original.toLowerCase(), original);
        }
      }

      if (valuesMap.size === 0) {
        caches[cacheKey] = {};
        continue;
      }

      // Consultar la entidad correspondiente
      const records = await this.queryLookup(model, field, tenantId);
      const map: Record<string, string> = {};
      for (const r of records) {
        const key = String((r as Record<string, unknown>)[field] ?? '').toLowerCase();
        map[key] = (r as { id: string }).id;
      }

      // Crear entidades faltantes si el campo lo permite
      if (col.createIfNotFound) {
        for (const [lower, original] of valuesMap) {
          if (!map[lower]) {
            const id = await this.createLookup(model, field, original, tenantId);
            if (id) {
              map[lower] = id;
              (created[model] ??= []).push(original);
            }
          }
        }
      }

      caches[cacheKey] = map;
    }

    return { caches, created };
  }

  private async createLookup(
    model: string,
    field: string,
    value: string,
    tenantId: string,
  ): Promise<string | null> {
    const nombre = value.trim();
    switch (model) {
      case 'clientes': {
        const r = await this.prisma.cliente.create({ data: { tenantId, nombre }, select: { id: true } });
        return r.id;
      }
      case 'transportistas': {
        const r = await this.prisma.transportista.create({ data: { tenantId, nombre }, select: { id: true } });
        return r.id;
      }
      case 'choferes': {
        const r = await this.prisma.chofer.create({ data: { tenantId, nombre }, select: { id: true } });
        return r.id;
      }
      default:
        return null;
    }
  }

  private async queryLookup(
    model: string,
    field: string,
    tenantId: string,
  ): Promise<{ id: string }[]> {
    const where = { tenantId };
    const select = { id: true, [field]: true };

    let raw: unknown;
    switch (model) {
      case 'clientes':
        raw = await this.prisma.cliente.findMany({ where, select });
        break;
      case 'choferes':
        raw = await this.prisma.chofer.findMany({ where, select });
        break;
      case 'vehiculos':
        raw = await this.prisma.vehiculo.findMany({ where, select });
        break;
      case 'transportistas':
        raw = await this.prisma.transportista.findMany({ where, select });
        break;
      default:
        return [];
    }
    return raw as { id: string }[];
  }
}

type LookupCaches = Record<string, Record<string, string>>;
