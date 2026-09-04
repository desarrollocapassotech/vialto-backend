import { getCatalogoFormulario } from "../../core/tenant-field-config/field-catalog";
import { prismaScalarFields } from "./prisma-import-fields";
import type {
  ColumnConfig,
  ColumnType,
  LookupModel,
  TemplateConfig,
} from "./types/import.types";

/**
 * Catálogo de campos importables por módulo.
 *
 * La lista base se arma en runtime desde el modelo Prisma (DMMF): si mañana
 * se agrega un scalar a Cliente/Viaje/etc., aparece acá solo. Encima hay un
 * overlay chico por módulo para lo que Prisma no puede inferir (lookups,
 * labels lindos, `warnIfEmpty`, columnas planas que no son un campo del
 * modelo — tipoFlota, producto, fechas de factura).
 *
 * El superadmin solo edita `excelHeader`, `required` (cuando no es
 * `systemRequired`), `defaultValue` y `createIfNotFound`.
 */
export interface CatalogoColumn {
  field: string;
  /** Nombre legible del campo del sistema, para mostrar en la UI. */
  campoLabel: string;
  type: ColumnType;
  /** true = el processor lo necesita sí o sí; el toggle "Obligatorio" queda forzado y deshabilitado. */
  systemRequired: boolean;
  /** Sugerencia inicial de excelHeader, editable por el superadmin. */
  defaultExcelHeader: string;
  /** Nombres alternativos del encabezado (sinónimos). Si el Excel trae alguno de estos, se mapea automáticamente. */
  excelHeaderAliases?: string[];
  lookupModel?: LookupModel;
  lookupFields?: string[];
  /** true = tiene sentido mostrar el toggle "Crear automáticamente si no existe". */
  createIfNotFoundSoportado?: boolean;
  /** true = la celda puede traer varios valores separados (ej. patente de tractor + semirremolque). */
  multiple?: boolean;
  /** Separador para `multiple` (default: "/"). */
  separador?: string;
  allowedValues?: string[];
  format?: string;
  /** true = recomendado pero no bloqueante: ver `ColumnConfig.warnIfEmpty`. */
  warnIfEmpty?: boolean;
}

type LookupOverlay = {
  lookupModel: LookupModel;
  lookupFields: string[];
  createIfNotFoundSoportado?: boolean;
  multiple?: boolean;
  separador?: string;
};

type FieldOverlay = Partial<
  Omit<CatalogoColumn, "field">
> & {
  /** Si true, el campo Prisma no se muestra (queda cubierto por otra columna o no aplica al Excel). */
  omitir?: boolean;
};

type ModuloDef = {
  prismaModel: string;
  altaFormulario?: { modulo: string; formulario: string };
  /**
   * Nombre de hoja sugerido cuando todavía no hay `ImportTemplate` propio del
   * tenant (ver `construirConfigPorDefecto`). El wizard de carga masiva sube
   * un único Excel con una hoja por módulo (Clientes/Transportes/Choferes/
   * Vehículos/Viajes) y llama preview/confirm una vez por módulo reusando el
   * mismo archivo — sin esto, el parser no tiene forma de saber qué hoja le
   * corresponde a cada módulo y cae en la primera hoja del archivo para
   * todos, duplicando datos de una hoja en las demás.
   */
  sheetDefault: string;
  /** Orden histórico de la planilla; campos nuevos (no listados) van al final. */
  ordenPreferido: string[];
  overlays: Record<string, FieldOverlay>;
  lookups: Record<string, LookupOverlay>;
  /** Columnas que no existen como scalar Prisma (tipoFlota, producto, etc.). */
  extras: CatalogoColumn[];
};

const LOOKUP_CLIENTE: LookupOverlay = {
  lookupModel: "clientes",
  lookupFields: ["nombre", "idFiscal"],
  createIfNotFoundSoportado: true,
};

const LOOKUP_TRANSPORTISTA: LookupOverlay = {
  lookupModel: "transportistas",
  lookupFields: ["nombre", "idFiscal"],
  createIfNotFoundSoportado: true,
};

// Solo se usa en la columna Chofer de la hoja de Viajes (mismo motivo que
// LOOKUP_CLIENTE_VIAJE/LOOKUP_TRANSPORTISTA_VIAJE): algunos tenants tipean
// ahí el DNI del chofer, no el nombre — matchear por DNI primero.
const LOOKUP_CHOFER: LookupOverlay = {
  lookupModel: "choferes",
  lookupFields: ["dni", "nombre"],
  createIfNotFoundSoportado: true,
};

/**
 * Solo para las columnas Cliente/Transporte de la hoja de Viajes: algunos
 * tenants (ej. NyM) tipean ahí el CUIT del cliente/transportista, no el
 * nombre — matchear primero por `idFiscal` y usar `nombre` como respaldo
 * para los tenants que sí tipean el nombre. No se reutiliza para
 * Choferes/Vehículos (columna "Transporte" de esas hojas), que siguen
 * matcheando por nombre primero vía `LOOKUP_TRANSPORTISTA`.
 */
const LOOKUP_CLIENTE_VIAJE: LookupOverlay = {
  ...LOOKUP_CLIENTE,
  lookupFields: ["idFiscal", "nombre"],
};

const LOOKUP_TRANSPORTISTA_VIAJE: LookupOverlay = {
  ...LOOKUP_TRANSPORTISTA,
  lookupFields: ["idFiscal", "nombre"],
};

const MODULOS: Record<string, ModuloDef> = {
  clientes: {
    prismaModel: "Cliente",
    altaFormulario: { modulo: "clientes", formulario: "alta_cliente" },
    sheetDefault: "Clientes",
    ordenPreferido: [
      "nombre",
      "idFiscal",
      "pais",
      "condicionIva",
      "condicionTributaria",
      "email",
      "telefono",
      "direccion",
    ],
    lookups: {},
    overlays: {
      nombre: { systemRequired: true, campoLabel: "Nombre" },
      idFiscal: {
        warnIfEmpty: true,
        campoLabel: "CUIT",
        defaultExcelHeader: "CUIT",
      },
      pais: { warnIfEmpty: true, campoLabel: "País" },
      condicionIva: {
        warnIfEmpty: true,
        campoLabel: "Condición IVA",
        defaultExcelHeader: "Cond. IVA",
      },
      condicionTributaria: { campoLabel: "Condición tributaria" },
    },
    extras: [],
  },
  transportistas: {
    prismaModel: "Transportista",
    altaFormulario: { modulo: "transportistas", formulario: "alta_transportista" },
    sheetDefault: "Transportes",
    ordenPreferido: [
      "nombre",
      "idFiscal",
      "pais",
      "email",
      "telefono",
      "domicilio",
      "condicionIva",
      "condicionTributaria",
      "comisionPct",
      "paut",
      "permisoInternacional",
      "fechaVencimientoPermiso",
    ],
    lookups: {},
    overlays: {
      nombre: { systemRequired: true, campoLabel: "Nombre" },
      idFiscal: {
        warnIfEmpty: true,
        campoLabel: "CUIT",
        defaultExcelHeader: "CUIT",
      },
      pais: { warnIfEmpty: true, campoLabel: "País" },
      condicionIva: {
        warnIfEmpty: true,
        campoLabel: "Condición IVA",
        defaultExcelHeader: "Cond. IVA",
      },
      condicionTributaria: { campoLabel: "Condición tributaria" },
      comisionPct: { campoLabel: "% Comisión", defaultExcelHeader: "% Comisión" },
      paut: { campoLabel: "PAUT" },
      permisoInternacional: { campoLabel: "Permiso internacional" },
      fechaVencimientoPermiso: {
        campoLabel: "Vto. permiso internacional",
        defaultExcelHeader: "Vto. permiso",
      },
    },
    extras: [],
  },
  choferes: {
    prismaModel: "Chofer",
    sheetDefault: "Choferes",
    ordenPreferido: [
      "nombre",
      "dni",
      "cuit",
      "licencia",
      "licenciaVence",
      "telefono",
      "transportistaId",
    ],
    lookups: { transportistaId: LOOKUP_TRANSPORTISTA },
    overlays: {
      nombre: { systemRequired: true, campoLabel: "Nombre" },
      dni: { campoLabel: "DNI" },
      cuit: { campoLabel: "CUIT" },
      licenciaVence: {
        campoLabel: "Vto. licencia",
        defaultExcelHeader: "Vto. Licencia",
      },
      telefono: { campoLabel: "Teléfono" },
      transportistaId: { campoLabel: "Transporte", defaultExcelHeader: "Transporte" },
    },
    extras: [],
  },
  vehiculos: {
    prismaModel: "Vehiculo",
    altaFormulario: { modulo: "vehiculos", formulario: "alta_vehiculo" },
    sheetDefault: "Vehículos",
    ordenPreferido: [
      "patente",
      "tipo",
      "marca",
      "modelo",
      "anio",
      "nroChasis",
      "poliza",
      "vencimientoPoliza",
      "tara",
      "precinto",
      "transportistaId",
    ],
    lookups: { transportistaId: LOOKUP_TRANSPORTISTA },
    overlays: {
      // El import acepta patente vacía (placeholder PENDIENTE-*) y tipo
      // inferido cuando vienen dos patentes en la misma celda.
      patente: { systemRequired: false, campoLabel: "Patente" },
      tipo: { systemRequired: false, campoLabel: "Tipo" },
      anio: { campoLabel: "Año" },
      nroChasis: { campoLabel: "Nro. de chasis" },
      poliza: { campoLabel: "Póliza" },
      vencimientoPoliza: {
        campoLabel: "Vto. póliza",
        defaultExcelHeader: "Vto. Póliza",
      },
      kmActual: { campoLabel: "Km actuales" },
      transportistaId: { campoLabel: "Transporte", defaultExcelHeader: "Transporte" },
    },
    extras: [],
  },
  viajes: {
    prismaModel: "Viaje",
    altaFormulario: { modulo: "viajes", formulario: "alta_viaje" },
    sheetDefault: "Viajes",
    ordenPreferido: [
      "numeroIdentificacionPersonalizado",
      "clienteId",
      "transportistaId",
      "transportistaEfectivoId",
      "tipoFlota",
      "choferId",
      "vehiculoId",
      "origen",
      "destino",
      "fechaCarga",
      "fechaDescarga",
      "detalleCarga",
      "kmRecorridos",
      "litrosConsumidos",
      "productoId",
      "cantidadProducto",
      "monto",
      "cantidadFactura",
      "precioUnitarioFactura",
      "nroFactura",
      "fechaEmisionFactura",
      "fechaVencimientoFactura",
      "cantidadTransportista",
      "precioUnitarioTransportista",
      "precioTransportistaExterno",
      "monedaPrecioTransportistaExterno",
      "observaciones",
      "monedaMonto",
    ],
    lookups: {
      clienteId: LOOKUP_CLIENTE_VIAJE,
      transportistaId: LOOKUP_TRANSPORTISTA_VIAJE,
      transportistaEfectivoId: LOOKUP_TRANSPORTISTA_VIAJE,
      choferId: LOOKUP_CHOFER,
    },
    overlays: {
      numeroIdentificacionPersonalizado: {
        campoLabel: "ID Personalizado",
        defaultExcelHeader: "ID Personalizado",
      },
      clienteId: { systemRequired: true, campoLabel: "Cliente" },
      transportistaId: {
        systemRequired: true,
        campoLabel: "Transporte",
        defaultExcelHeader: "Transporte",
      },
      transportistaEfectivoId: {
        campoLabel: "Transporte subcontratado",
        defaultExcelHeader: "Transporte subcontratado",
      },
      choferId: { campoLabel: "Chofer" },
      origen: { systemRequired: true, campoLabel: "Origen" },
      destino: { systemRequired: true, campoLabel: "Destino" },
      fechaCarga: { systemRequired: true, campoLabel: "Fecha de carga", defaultExcelHeader: "Fecha carga" },
      fechaDescarga: { campoLabel: "Fecha de descarga", defaultExcelHeader: "Fecha descarga" },
      detalleCarga: { campoLabel: "Detalle de carga" },
      kmRecorridos: { campoLabel: "Km recorridos" },
      litrosConsumidos: { campoLabel: "Litros consumidos" },
      monto: { campoLabel: "Monto total a cliente", defaultExcelHeader: "Monto total a cliente" },
      cantidadFactura: { campoLabel: "Cantidad a facturar" },
      precioUnitarioFactura: { campoLabel: "Precio unitario a facturar" },
      nroFactura: {
        campoLabel: "N° factura a cliente",
        defaultExcelHeader: "N° factura a cliente",
      },
      cantidadTransportista: { campoLabel: "Cantidad transportista" },
      precioUnitarioTransportista: { campoLabel: "Precio unitario transportista" },
      precioTransportistaExterno: {
        campoLabel: "Monto total a transportista (flete)",
        defaultExcelHeader: "Monto total a transportista (flete)",
        excelHeaderAliases: ["Pago neto"],
      },
      monedaPrecioTransportistaExterno: {
        campoLabel: "Moneda flete",
        defaultExcelHeader: "Moneda flete",
      },
      monedaMonto: { campoLabel: "Moneda" },
      gananciaBrutaManual: { campoLabel: "Ganancia bruta manual" },
      monedaGananciaBrutaManual: { campoLabel: "Moneda ganancia bruta" },
      precioTransportistaIvaIncluidoPct: {
        campoLabel: "% IVA transportista (pago en efectivo)",
        defaultExcelHeader: "% IVA transportista",
      },
    },
    extras: [
      {
        field: "tipoFlota",
        campoLabel: "Tipo de flota",
        type: "enum",
        systemRequired: false,
        defaultExcelHeader: "Tipo de flota",
        allowedValues: ["PROPIA", "TERCERO"],
      },
      {
        field: "vehiculoId",
        campoLabel: "Vehículo",
        type: "lookup",
        systemRequired: false,
        defaultExcelHeader: "Vehículo",
        lookupModel: "vehiculos",
        lookupFields: ["patente"],
        createIfNotFoundSoportado: false,
        multiple: true,
        separador: "/",
      },
      {
        field: "productoId",
        campoLabel: "Producto",
        type: "lookup",
        systemRequired: false,
        defaultExcelHeader: "Producto",
        lookupModel: "productos",
        lookupFields: ["nombre", "codigo"],
        createIfNotFoundSoportado: true,
      },
      {
        field: "cantidadProducto",
        campoLabel: "Cantidad de producto",
        type: "number",
        systemRequired: false,
        defaultExcelHeader: "Cantidad de producto",
      },
      {
        field: "fechaEmisionFactura",
        campoLabel: "Fecha emisión factura cliente",
        type: "date",
        systemRequired: false,
        defaultExcelHeader: "Fecha emisión factura cliente",
      },
      {
        field: "fechaVencimientoFactura",
        campoLabel: "Fecha vencimiento factura cliente",
        type: "date",
        systemRequired: false,
        defaultExcelHeader: "Fecha vencimiento factura cliente",
      },
    ],
  },
};

function prismaTypeToColumnType(prismaType: string): ColumnType {
  if (prismaType === "Int" || prismaType === "Float" || prismaType === "Decimal") {
    return "number";
  }
  if (prismaType === "DateTime") return "date";
  if (prismaType === "Boolean") return "boolean";
  return "string";
}

function humanize(field: string): string {
  const sinId = field.endsWith("Id") ? field.slice(0, -2) : field;
  const spaced = sinId.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelDesdeAlta(def: ModuloDef, field: string): string | undefined {
  if (!def.altaFormulario) return undefined;
  return getCatalogoFormulario(
    def.altaFormulario.modulo,
    def.altaFormulario.formulario,
  ).find((c) => c.campo === field)?.label;
}

function columnaDesdePrisma(
  def: ModuloDef,
  field: ReturnType<typeof prismaScalarFields>[number],
): CatalogoColumn | null {
  const overlay = def.overlays[field.name] ?? {};
  if (overlay.omitir) return null;

  const lookup = def.lookups[field.name];
  const campoLabel =
    overlay.campoLabel ??
    labelDesdeAlta(def, field.name) ??
    humanize(field.name);
  const type: ColumnType =
    overlay.type ??
    (lookup ? "lookup" : prismaTypeToColumnType(field.type));
  const systemRequired =
    overlay.systemRequired ?? (field.isRequired && !field.hasDefaultValue);

  const col: CatalogoColumn = {
    field: field.name,
    campoLabel,
    type,
    systemRequired,
    defaultExcelHeader: overlay.defaultExcelHeader ?? campoLabel,
  };
  if (overlay.warnIfEmpty) col.warnIfEmpty = true;
  if (overlay.format) col.format = overlay.format;
  if (overlay.allowedValues) col.allowedValues = overlay.allowedValues;
  if (overlay.excelHeaderAliases) col.excelHeaderAliases = overlay.excelHeaderAliases;
  if (lookup) {
    col.lookupModel = lookup.lookupModel;
    col.lookupFields = lookup.lookupFields;
    col.createIfNotFoundSoportado = lookup.createIfNotFoundSoportado;
    if (lookup.multiple) {
      col.multiple = true;
      col.separador = lookup.separador ?? "/";
    }
  }
  if (overlay.lookupModel) col.lookupModel = overlay.lookupModel;
  if (overlay.lookupFields) col.lookupFields = overlay.lookupFields;
  if (overlay.createIfNotFoundSoportado != null) {
    col.createIfNotFoundSoportado = overlay.createIfNotFoundSoportado;
  }
  if (overlay.multiple) {
    col.multiple = true;
    col.separador = overlay.separador ?? "/";
  }
  return col;
}

function ordenar(columnas: CatalogoColumn[], preferido: string[]): CatalogoColumn[] {
  const rank = new Map(preferido.map((f, i) => [f, i]));
  return [...columnas].sort((a, b) => {
    const ra = rank.get(a.field) ?? preferido.length + columnas.indexOf(a);
    const rb = rank.get(b.field) ?? preferido.length + columnas.indexOf(b);
    return ra - rb;
  });
}

function buildModulo(def: ModuloDef): CatalogoColumn[] {
  const desdePrisma: CatalogoColumn[] = [];
  for (const field of prismaScalarFields(def.prismaModel)) {
    const col = columnaDesdePrisma(def, field);
    if (col) desdePrisma.push(col);
  }
  const ya = new Set(desdePrisma.map((c) => c.field));
  const extras = def.extras.filter((e) => !ya.has(e.field));
  return ordenar([...desdePrisma, ...extras], def.ordenPreferido);
}

let cache: Record<string, CatalogoColumn[]> | null = null;

function catalogoPorModulo(): Record<string, CatalogoColumn[]> {
  if (cache) return cache;
  cache = {};
  for (const [modulo, def] of Object.entries(MODULOS)) {
    cache[modulo] = buildModulo(def);
  }
  return cache;
}

export function getCatalogoColumnas(modulo: string): CatalogoColumn[] {
  return catalogoPorModulo()[modulo] ?? [];
}

/**
 * Formulario de alta (catálogo de `tenant-field-config`) que decide, para un
 * módulo de importación, qué campos están visibles para un tenant puntual.
 * `undefined` = el módulo no tiene contraparte en `FIELD_CATALOG` (ej.
 * `choferes`) — en ese caso no hay nada que filtrar.
 */
export function getAltaFormularioDeModulo(
  modulo: string,
): { modulo: string; formulario: string } | undefined {
  return MODULOS[modulo]?.altaFormulario;
}

/** Snapshot lazy del catálogo (misma fuente que `getCatalogoColumnas`). */
export const TEMPLATE_CATALOGO: Record<string, CatalogoColumn[]> =
  catalogoPorModulo();

/**
 * Config de importación por defecto para un módulo, armada a partir del
 * catálogo (mismos encabezados sugeridos que ve el superadmin al abrir
 * el formulario). Se usa como fallback cuando el tenant todavía no tiene un
 * `ImportTemplate` propio — así ningún módulo queda bloqueado por falta de
 * configuración. Devuelve `null` si el módulo no tiene catálogo definido.
 */
export function construirConfigPorDefecto(modulo: string): TemplateConfig | null {
  const columnas = getCatalogoColumnas(modulo);
  if (columnas.length === 0) return null;

  return {
    sheet: MODULOS[modulo]?.sheetDefault,
    headerRow: 1,
    columns: columnas.map((c): ColumnConfig => {
      const col: ColumnConfig = {
        excelHeader: c.defaultExcelHeader,
        field: c.field,
        type: c.type,
        required: c.systemRequired,
      };
      if (c.type === "lookup") {
        col.lookupModel = c.lookupModel;
        if (c.lookupFields) col.lookupFields = c.lookupFields;
      }
      if (c.allowedValues) col.allowedValues = c.allowedValues;
      if (c.format) col.format = c.format;
      if (c.warnIfEmpty) col.warnIfEmpty = true;
      if (c.excelHeaderAliases) col.excelHeaderAliases = c.excelHeaderAliases;
      return col;
    }),
  };
}
