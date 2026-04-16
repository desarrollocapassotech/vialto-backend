import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import type { TemplateConfig, ParsedRow } from '../types/import.types';

@Injectable()
export class ParserService {
  parse(buffer: Buffer, config: TemplateConfig): ParsedRow[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new BadRequestException('El archivo no es un Excel válido (.xlsx / .xls)');
    }

    const sheetName = this.resolveSheetName(workbook, config.sheet);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new BadRequestException(`Hoja "${sheetName}" no encontrada en el archivo`);
    }

    // Convertir la hoja a array de arrays (raw)
    const allRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false, // devuelve fechas como string formateado; usamos cellDates=true para objetos Date
    });

    const headerRowIndex = (config.headerRow ?? 1) - 1;
    if (allRows.length <= headerRowIndex) {
      throw new BadRequestException('El archivo no contiene filas de datos');
    }

    const headers = (allRows[headerRowIndex] as unknown[]).map((h) =>
      h != null ? String(h).trim() : '',
    );

    const dataRows = allRows.slice(headerRowIndex + 1);

    const parsed: ParsedRow[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const raw = dataRows[i] as unknown[];

      // Saltear filas completamente vacías
      if (raw.every((cell) => cell == null || String(cell).trim() === '')) {
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
        const value = colIndex >= 0 ? (raw[colIndex] ?? null) : null;
        row[col.field] = value;
      }

      // Columnas del Excel que no tienen mapeo → se concatenan en _unmappedText
      const extraParts: string[] = [];
      for (let ci = 0; ci < headers.length; ci++) {
        const header = headers[ci];
        if (!header || mappedHeadersLower.has(header.toLowerCase())) continue;
        const cellValue = raw[ci];
        if (cellValue == null || String(cellValue).trim() === '') continue;
        extraParts.push(`${header}: ${String(cellValue).trim()}`);
      }
      row._unmappedText = extraParts.length > 0 ? extraParts.join('\n') : null;

      parsed.push(row);
    }

    return parsed;
  }

  private resolveSheetName(
    workbook: XLSX.WorkBook,
    sheet?: string | number,
  ): string {
    if (sheet == null) return workbook.SheetNames[0];
    if (typeof sheet === 'number') {
      const name = workbook.SheetNames[sheet];
      if (!name) {
        throw new BadRequestException(
          `Índice de hoja ${sheet} fuera de rango`,
        );
      }
      return name;
    }
    if (!workbook.SheetNames.includes(sheet)) {
      throw new BadRequestException(`Hoja "${sheet}" no encontrada en el archivo`);
    }
    return sheet;
  }
}
