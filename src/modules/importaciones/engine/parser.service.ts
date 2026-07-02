import { BadRequestException, Injectable } from "@nestjs/common";
import * as XLSX from "xlsx";
import type { TemplateConfig, ParsedRow } from "../types/import.types";

@Injectable()
export class ParserService {
  parse(buffer: Buffer, config: TemplateConfig): ParsedRow[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch {
      throw new BadRequestException(
        "El archivo no es un Excel válido (.xlsx / .xls)",
      );
    }

    const sheetName = this.resolveSheetName(workbook, config.sheet);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new BadRequestException(
        `Hoja "${sheetName}" no encontrada en el archivo`,
      );
    }

    // Convertir la hoja a array de arrays (raw)
    const allRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true, // devuelve fechas como string formateado; usamos cellDates=true para objetos Date
    });

    const headerRowIndex = (config.headerRow ?? 1) - 1;
    if (allRows.length <= headerRowIndex) {
      throw new BadRequestException("El archivo no contiene filas de datos");
    }

    const headers = (allRows[headerRowIndex] as unknown[]).map((h) =>
      h != null ? String(h).trim() : "",
    );

    const dataRows = allRows.slice(headerRowIndex + 1);

    const parsed: ParsedRow[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const raw = dataRows[i] as unknown[];

      // Saltear filas completamente vacías
      if (raw.every((cell) => cell == null || String(cell).trim() === "")) {
        continue;
      }

      const row: ParsedRow = { _rowNum: headerRowIndex + 2 + i }; // número de fila en el Excel (1-based)

      const mappedHeadersLower = new Set(
        config.columns.map((c) => c.excelHeader.toLowerCase()),
      );

      for (const col of config.columns) {
        const colIndex = headers.findIndex(
          (h) => h.toLowerCase() === col.excelHeader.toLowerCase(),
        );
        if (colIndex >= 0) {
          const cell = raw[colIndex] ?? null;
          row[col.field] =
            col.type === "date" ? normalizeExcelDate(cell, col.format) : cell;
        }
      }

      // Columnas del Excel que no tienen mapeo → se concatenan en _unmappedText
      const extraParts: string[] = [];
      for (let ci = 0; ci < headers.length; ci++) {
        const header = headers[ci];
        if (!header || mappedHeadersLower.has(header.toLowerCase())) continue;
        const cellValue = raw[ci];
        if (cellValue == null || String(cellValue).trim() === "") continue;
        extraParts.push(`${header}: ${String(cellValue).trim()}`);
      }
      row._unmappedText = extraParts.length > 0 ? extraParts.join("\n") : null;

      parsed.push(row);
    }

    return parsed;
  }

  private resolveSheetName(
    workbook: XLSX.WorkBook,
    sheet?: string | number,
  ): string {
    if (sheet == null) return workbook.SheetNames[0];
    if (typeof sheet === "number") {
      const name = workbook.SheetNames[sheet];
      if (!name) {
        throw new BadRequestException(`Índice de hoja ${sheet} fuera de rango`);
      }
      return name;
    }
    if (!workbook.SheetNames.includes(sheet)) {
      throw new BadRequestException(
        `Hoja "${sheet}" no encontrada en el archivo`,
      );
    }
    return sheet;
  }
}

function normalizeExcelDate(value: unknown, format?: string): Date | null {
  if (value == null || String(value).trim() === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    // Usamos getUTC* para que el -3 de Argentina no nos tire la fecha al día anterior
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        3,
        0,
        0,
      ),
    );
  }

  const s = String(value).trim();

  if (format) {
    const parsed = parseWithFormat(s, format);
    if (parsed) return parsed;
  }

  const dmy = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy.map(Number);
    if (y < 100) y += 2000;
    return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso.map(Number);
    return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
  }

  return null;
}

function parseWithFormat(s: string, format: string): Date | null {
  const nums = s.split(/[/\-.]/).map(Number);
  const parts = format.toUpperCase().split(/[/\-.]/);
  if (nums.length !== parts.length || nums.some(isNaN)) return null;

  let d = 0,
    m = 0,
    y = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("D")) d = nums[i];
    else if (p.startsWith("M")) m = nums[i];
    else if (p.startsWith("Y")) y = nums[i];
  }
  if (!d || !m || !y) return null;
  if (y < 100) y += 2000;

  // Rechazar combinaciones imposibles en vez de dejar que Date las "desborde"
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
  // Verificar que no hubo rollover (ej. 31/02 → 03/03)
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;

  return date;
}
