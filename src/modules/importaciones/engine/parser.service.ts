import { BadRequestException, Injectable } from "@nestjs/common";
import * as XLSX from "xlsx";
import type { TemplateConfig, ParsedRow } from "../types/import.types";

@Injectable()
export class ParserService {
  /** Lee la hoja completa como array de arrays + la fila de encabezados ya resuelta. */
  private readSheetRows(
    buffer: Buffer,
    sheet?: string | number,
    headerRow?: number,
  ): { headers: string[]; allRows: unknown[][]; headerRowIndex: number } {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch {
      throw new BadRequestException(
        "El archivo no es un Excel válido (.xlsx / .xls)",
      );
    }

    const sheetName = this.resolveSheetName(workbook, sheet);
    const sheetObj = workbook.Sheets[sheetName];
    if (!sheetObj) {
      throw new BadRequestException(
        `Hoja "${sheetName}" no encontrada en el archivo`,
      );
    }

    const allRows: unknown[][] = XLSX.utils.sheet_to_json(sheetObj, {
      header: 1,
      defval: null,
      raw: true, // devuelve fechas como string formateado; usamos cellDates=true para objetos Date
    });

    const headerRowIndex = (headerRow ?? 1) - 1;
    if (allRows.length <= headerRowIndex) {
      throw new BadRequestException("El archivo no contiene filas de datos");
    }

    const headers = (allRows[headerRowIndex] as unknown[]).map((h) =>
      h != null ? String(h).trim() : "",
    );

    return { headers, allRows, headerRowIndex };
  }

  /**
   * Primeras filas crudas de CADA hoja del archivo, sin asumir todavía cuál
   * es la hoja correcta ni dónde está la fila de encabezados — lo usa la
   * sugerencia de mapeo con IA (ver ia-template-suggestion) para elegir
   * también la hoja y la fila de encabezados, no solo el mapeo de columnas.
   */
  sampleWorkbook(
    buffer: Buffer,
    maxRows = 10,
  ): { nombre: string; filas: unknown[][] }[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch {
      throw new BadRequestException(
        "El archivo no es un Excel válido (.xlsx / .xls)",
      );
    }
    return workbook.SheetNames.map((nombre) => {
      const sheetObj = workbook.Sheets[nombre];
      const filas = XLSX.utils.sheet_to_json(sheetObj, {
        header: 1,
        defval: null,
        raw: true,
      }) as unknown[][];
      return { nombre, filas: filas.slice(0, maxRows) };
    });
  }

  parse(
    buffer: Buffer,
    config: TemplateConfig,
  ): { rows: ParsedRow[]; headers: string[] } {
    const { headers, allRows, headerRowIndex } = this.readSheetRows(
      buffer,
      config.sheet,
      config.headerRow,
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

      const mappedHeadersLower = new Set<string>();

      for (const col of config.columns) {
        const validHeaders = [col.excelHeader, ...(col.excelHeaderAliases || [])].map(h => h.toLowerCase());
        const colIndex = headers.findIndex((h) => validHeaders.includes(h.toLowerCase()));
        
        if (colIndex >= 0) {
          mappedHeadersLower.add(headers[colIndex].toLowerCase());
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

    return { rows: parsed, headers: headers.filter((h) => h !== "") };
  }

  private resolveSheetName(
    workbook: XLSX.WorkBook,
    sheet?: string | number,
  ): string {
    if (sheet == null) {
      // Sin hoja configurada en el template: si el archivo tiene una sola
      // hoja no hay ambigüedad posible. Si tiene varias (ej. el Excel único
      // multi-hoja del wizard de carga masiva: Clientes/Transportes/
      // Choferes/Vehículos/Viajes, subido una vez y reusado para el
      // preview/confirm de cada módulo) asumir la primera sería leer la hoja
      // de otro módulo — causa real detectada: clientes duplicados como
      // transportistas/choferes porque todos terminaban leyendo la hoja
      // Clientes. Mejor fallar claro que importar datos de la hoja
      // equivocada en silencio.
      if (workbook.SheetNames.length > 1) {
        throw new BadRequestException(
          "El archivo tiene varias hojas y la plantilla de importación de este módulo no especifica cuál usar. " +
            'Configurá el campo "Hoja del Excel" en la plantilla (pestaña Templates).',
        );
      }
      return workbook.SheetNames[0];
    }
    if (typeof sheet === "number") {
      const name = workbook.SheetNames[sheet];
      if (!name) {
        throw new BadRequestException(`Índice de hoja ${sheet} fuera de rango`);
      }
      return name;
    }
    // Comparación insensible a mayúsculas/acentos: el nombre de hoja real del
    // tenant puede no coincidir carácter a carácter con el configurado
    // ("Transportes" vs "TRANSPORTES" vs "Tránsportes").
    const target = normalizeSheetName(sheet);
    const name = workbook.SheetNames.find((n) => normalizeSheetName(n) === target);
    if (!name) {
      throw new BadRequestException(
        `Hoja "${sheet}" no encontrada en el archivo`,
      );
    }
    return name;
  }
}

function normalizeSheetName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
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
