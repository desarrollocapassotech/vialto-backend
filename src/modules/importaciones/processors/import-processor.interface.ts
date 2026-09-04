import type { IdFiscalConflicto, ValidatedRow } from '../types/import.types';

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
  /**
   * Números de fila (`ValidatedRow._rowNum`) que son alta nueva (no existen
   * todavía) — el preview lo usa para marcar "Nuevo"/"Actualiza" en el
   * detalle fila por fila de los módulos "simples" (Clientes, Transportistas,
   * Choferes, Vehículos). El resto de los datos de cada fila (todas las
   * columnas configuradas) lo arma `ImportacionesService.preview()` a partir
   * del Excel crudo — este método solo resuelve el criterio de "existe o
   * no", que es específico de cada processor (nombre insensible a mayúsculas
   * para la mayoría, patente con posible split tractor/semirremolque en
   * Vehículos). Viajes no lo implementa: arma su propio detalle
   * (`ImportacionesService.buildViajesPreview`).
   */
  filasNuevas?(rows: ValidatedRow[], tenantId: string): Promise<Set<number>>;
  /**
   * Solo Clientes: detecta filas cuyo ID Fiscal ya pertenece a otro cliente
   * existente (nombre distinto) — ver `IdFiscalConflicto`. El preview lo
   * muestra y `confirm()` exige una decisión por fila (ignorar/actualizar)
   * antes de importar.
   */
  detectarIdFiscalDuplicado?(
    rows: ValidatedRow[],
    tenantId: string,
  ): Promise<IdFiscalConflicto[]>;
}
