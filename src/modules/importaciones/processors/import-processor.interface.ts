import type { ValidatedRow } from '../types/import.types';

export interface InsertResult {
  id: string;
  /** true = alta nueva, false = actualizó un registro ya existente. Para el resumen final del import. */
  creado: boolean;
  /** Solo Viajes: true = esta fila quedó con una factura individual adjunta (por `nroFactura`). Usado para avisar antes de generar facturas consolidadas por encima. */
  facturado?: boolean;
}

export interface IImportProcessor {
  /** Inserta (o actualiza) una fila ya validada. */
  insert(row: ValidatedRow, tenantId: string, createdBy: string): Promise<InsertResult>;
  /**
   * Cuántas de las filas ya existen en el sistema (van a actualizarse en vez
   * de crearse) — el preview lo usa para mostrar "N nuevos / N a actualizar"
   * en vez de asumir que toda fila válida es una creación. Opcional: solo
   * para no obligar a implementarlo en processors nuevos.
   */
  contarExistentes?(rows: ValidatedRow[], tenantId: string): Promise<number>;
}
