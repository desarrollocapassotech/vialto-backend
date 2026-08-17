import type { ValidatedRow } from '../types/import.types';

export interface IImportProcessor {
  /** Inserta una fila ya validada. Retorna el ID del registro creado. */
  insert(row: ValidatedRow, tenantId: string, createdBy: string): Promise<string>;
  /**
   * Cuántas de las filas ya existen en el sistema (van a actualizarse en vez
   * de crearse) — el preview lo usa para mostrar "N nuevos / N a actualizar"
   * en vez de asumir que toda fila válida es una creación. Opcional: solo
   * para no obligar a implementarlo en processors nuevos.
   */
  contarExistentes?(rows: ValidatedRow[], tenantId: string): Promise<number>;
}
