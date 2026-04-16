import type { ValidatedRow } from '../types/import.types';

export interface IImportProcessor {
  /** Inserta una fila ya validada. Retorna el ID del registro creado. */
  insert(row: ValidatedRow, tenantId: string, createdBy: string): Promise<string>;
}
