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
  /** Nombres alternativos del encabezado (sinónimos). Si el Excel trae alguno de estos, se mapea automáticamente. */
  excelHeaderAliases?: string[];
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

export interface PreviewFilaCampo {
  campo: string;
  label: string;
  valor: string;
}

/** Detalle fila por fila de un módulo "simple" (Clientes/Transportistas/Choferes/Vehículos): todas las columnas configuradas con su valor tal como viene del Excel, no solo el nombre. */
export interface PreviewFilaEntidad {
  fila: number;
  /** true = alta nueva, false = actualiza un registro ya existente (ver `IImportProcessor.filasNuevas`). */
  esNuevo: boolean;
  campos: PreviewFilaCampo[];
}

export interface PreviewCambioCampo {
  campo: string;
  antes: string | number | null;
  despues: string | number | null;
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
  /** true = este viaje no existe todavía (alta nueva). false = actualiza uno existente. */
  nuevo: boolean;
  /** Solo si `nuevo` es false: campos que cambian respecto al valor actual, con su antes/después. */
  cambios?: PreviewCambioCampo[];
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
  /**
   * Solo viajes: números de factura que van a terminar compartidos por más
   * de un viaje nuevo (o que ya existen de otro import) — `confirm()` los
   * reutiliza y suma el importe en vez de duplicarlos, pero necesita
   * confirmación explícita antes (`ConfirmImportDto.confirmarFacturasDuplicadas`).
   */
  advertenciasFacturasDuplicadas?: { numero: string; filas: number[] }[];
  viajes?: PreviewViaje[];
  facturas?: PreviewFactura[];
  clientes?: PreviewEntidad[];
  transportistas?: PreviewEntidad[];
  /**
   * Solo módulos "simples" (Clientes, Transportistas, Choferes, Vehículos):
   * detalle fila por fila con TODAS las columnas configuradas (no solo el
   * nombre) tal como vienen del Excel, + si esa fila es alta nueva o
   * actualiza un registro existente. Viajes no lo usa — ya tiene
   * `viajes`/`clientes`/`transportistas` arriba.
   */
  filasDetalle?: PreviewFilaEntidad[];
}

/** Una columna esperada por el template activo (propio del tenant, o el default si no configuró uno). */
export interface ColumnaEsperada {
  /** Nombre de encabezado que el Excel del tenant debe tener, tal cual (case-insensitive al parsear). */
  excelHeader: string;
  /** Nombre legible del campo del sistema (para mostrar junto al encabezado, no para escribir en el Excel). */
  campoLabel: string;
  tipo: ColumnType;
  requerido: boolean;
  /** Recomendado pero no bloqueante — ver `ColumnConfig.warnIfEmpty`. */
  recomendado?: boolean;
  /** Para tipo='enum': valores permitidos. */
  allowedValues?: string[];
  /** Para tipo='lookup': contra qué entidad busca. */
  lookupModel?: LookupModel;
}

/** Columnas esperadas de un módulo, para mostrarle al usuario antes de armar su Excel. */
export interface ColumnasEsperadasModulo {
  modulo: string;
  /** Hoja sugerida del Excel para este módulo (nombre por defecto — el template del tenant puede tener otro). */
  sheet: string;
  columnas: ColumnaEsperada[];
}
