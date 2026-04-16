export type LookupModel =
  | 'clientes'
  | 'choferes'
  | 'vehiculos'
  | 'transportistas';

export type ColumnType = 'string' | 'number' | 'date' | 'boolean' | 'lookup';

export interface ColumnConfig {
  /** Nombre del encabezado en el Excel del cliente */
  excelHeader: string;
  /** Nombre del campo en el sistema */
  field: string;
  type: ColumnType;
  /** Para type='date': formato de la cadena, ej. 'DD/MM/YYYY' */
  format?: string;
  /** Para type='lookup': entidad a buscar */
  lookupModel?: LookupModel;
  /** Para type='lookup': campo por el que se busca (default: 'nombre') */
  lookupField?: string;
  /** Para type='lookup': si no se encuentra, crear el registro automáticamente */
  createIfNotFound?: boolean;
  required?: boolean;
}

export interface TemplateConfig {
  /** Nombre o índice (0-based) de la hoja. Default: primera hoja */
  sheet?: string | number;
  /** Fila de encabezados, 1-based. Default: 1 */
  headerRow?: number;
  columns: ColumnConfig[];
}

/** Fila parseada del Excel (antes de validar) */
export interface ParsedRow {
  _rowNum: number;
  /** Columnas del Excel sin mapeo concatenadas como "Header: valor\nHeader2: valor2" */
  _unmappedText?: string | null;
  [key: string]: unknown;
}

/** Fila validada y lista para insertar */
export interface ValidatedRow {
  _rowNum: number;
  [key: string]: string | number | Date | null | undefined;
}

export interface RowError {
  fila: number;
  campo?: string;
  error: string;
  valor?: unknown;
}

export interface PreviewEntidad {
  nombre: string;
  esNuevo: boolean;
}

export interface PreviewViaje {
  fila: number;
  cliente: string;
  transporte: string | null;
  origen: string | null;
  destino: string | null;
  fechaCarga: string | null;
  fechaDescarga: string | null;
  detalleCarga: string | null;
  monto: number | null;
  nroFactura: string | null;
  precioTransportistaExterno: number | null;
  nroFacturaTransporte: string | null;
}

export interface PreviewFactura {
  tipo: 'cliente' | 'transportista_externo';
  numero: string;
  nombre: string | null;
  importe: number;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
}

export interface PreviewResult {
  sessionId: string;
  modulo: string;
  nombreArchivo: string;
  totalFilas: number;
  exitosas: number;
  errores: number;
  detalleErrores: RowError[];
  viajes?: PreviewViaje[];
  facturas?: PreviewFactura[];
  clientes?: PreviewEntidad[];
  transportistas?: PreviewEntidad[];
}
