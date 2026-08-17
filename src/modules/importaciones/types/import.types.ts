export type LookupModel =
  | 'clientes'
  | 'choferes'
  | 'vehiculos'
  | 'transportistas'
  | 'productos';

export type ColumnType = 'string' | 'number' | 'date' | 'boolean' | 'lookup' | 'enum';

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
  /** Para type='lookup': campo por el que se busca (default: 'nombre'). Ignorado si `lookupFields` está presente. */
  lookupField?: string;
  /**
   * Para type='lookup': lista de campos candidatos a probar en orden con el
   * mismo valor tipeado (ej. `['nombre', 'idFiscal']`) — así un typo en el
   * nombre no bloquea la fila si el CUIT sí matchea, sin depender de un ID
   * inventado que obligue a saltar entre hojas para copiarlo.
   */
  lookupFields?: string[];
  /** Para type='lookup': si no se encuentra, crear el registro automáticamente */
  createIfNotFound?: boolean;
  /**
   * Para type='lookup': la celda trae varios valores separados por
   * `separador` (ej. "NPY239/KGA38" = tractor + semirremolque) — se busca
   * cada uno por separado y el resultado es un array de ids en vez de uno
   * solo. Si alguno no matchea, la fila entera se rechaza igual que un
   * lookup simple fallido.
   */
  multiple?: boolean;
  /** Separador para `multiple` (default: "/"). */
  separador?: string;
  required?: boolean;
  allowedValues?: string[];
  /**
   * Valor a usar cuando la celda viene vacía y la columna no es `required`.
   * Solo tiene sentido para campos sin restricción de unicidad (ej. TIPO de
   * vehículo) — nunca usar para un campo único, porque todas las filas vacías
   * chocarían con el mismo valor.
   */
  defaultValue?: string;
  /**
   * Campo recomendado pero no bloqueante: si la celda viene vacía, la fila
   * se importa igual (no es un error), pero se junta en
   * `PreviewResult.advertenciasCamposFaltantes` y el usuario tiene que
   * confirmar explícitamente antes de poder importar (ver `confirm()` /
   * `ConfirmImportDto.confirmarCamposFaltantes`).
   */
  warnIfEmpty?: boolean;
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
  [key: string]: string | number | Date | string[] | null | undefined;
}

export interface RowError {
  fila: number;
  campo?: string;
  error: string;
  valor?: unknown;
  /** Si el error es un lookup no encontrado: qué modelo se buscó. */
  lookupModel?: string;
  /**
   * Valores puntuales que no matchearon, con su posición dentro de la celda
   * (0 para lookup simple; 0/1/... para columnas `multiple`, ej. patente de
   * tractor + semirremolque) — permite agrupar "faltantes" distintos entre
   * filas y sugerir un valor por posición (ver `entidadesFaltantes`).
   */
  valoresNoEncontrados?: { valor: string; posicion: number }[];
}

export interface EntidadFaltante {
  valor: string;
  /** Sugerencia derivada de una regla simple (ej. posición en el par), no de IA. */
  tipoSugerido?: string | null;
}

export interface EntidadesFaltantesModelo {
  modelo: string;
  valores: EntidadFaltante[];
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
  chofer: string | null;
  vehiculo: string | null;  
  fechaCarga: string | null;
  fechaDescarga: string | null;
  detalleCarga: string | null;
  monto: number | null;
  monedaMonto: string | null;
  nroFactura: string | null;
  precioTransportistaExterno: number | null;
  monedaPrecioTransportistaExterno: string | null;
}

export interface PreviewFactura {
  /** Siempre "cliente": el pago al transportista se liquida por afuera (Liquidaciones), no como Factura. */
  tipo: 'cliente';
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
  /** Columnas del Excel que no matchean ningún campo del template — van a texto libre en Observaciones. */
  headersNoMapeados: string[];
  /** Columnas del template (no obligatorias) que no se encontraron en el Excel. */
  columnasOpcionalesFaltantes: string[];
  /** Entidades referenciadas por lookup que no existen todavía, agrupadas por modelo. */
  entidadesFaltantes: EntidadesFaltantesModelo[];
  /**
   * Filas que van a importarse igual pero con algún campo recomendado
   * (`warnIfEmpty`) vacío — ej. cliente sin CUIT/país. No bloquean el
   * preview, pero `confirm()` los rechaza salvo que el usuario los
   * confirme explícitamente (`ConfirmImportDto.confirmarCamposFaltantes`).
   */
  advertenciasCamposFaltantes: { fila: number; campos: string[] }[];
  /**
   * Desglose de `exitosas` entre altas y actualizaciones (el processor ya
   * hace upsert por nombre/patente) — solo presente si el módulo lo
   * soporta (`IImportProcessor.contarExistentes`).
   */
  entidadesNuevas?: number;
  entidadesActualizadas?: number;
  viajes?: PreviewViaje[];
  facturas?: PreviewFactura[];
  clientes?: PreviewEntidad[];
  transportistas?: PreviewEntidad[];
}
