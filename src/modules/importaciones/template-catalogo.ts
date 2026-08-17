import type {
  ColumnConfig,
  ColumnType,
  LookupModel,
  TemplateConfig,
} from "./types/import.types";

/**
 * Catálogo fijo de campos importables por módulo — fuente de verdad única
 * para la UI de configuración de templates (evita que el superadmin tenga
 * que escribir a mano nombres de campo que no coinciden con lo que el
 * processor realmente lee). El superadmin solo edita `excelHeader` (el
 * nombre real de columna en el Excel del tenant), `required` (cuando no es
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

export const TEMPLATE_CATALOGO: Record<string, CatalogoColumn[]> = {
  clientes: [
    { field: "nombre", campoLabel: "Nombre", type: "string", systemRequired: true, defaultExcelHeader: "Nombre" },
    { field: "idFiscal", campoLabel: "CUIT", type: "string", systemRequired: false, warnIfEmpty: true, defaultExcelHeader: "CUIT" },
    { field: "pais", campoLabel: "País", type: "string", systemRequired: false, warnIfEmpty: true, defaultExcelHeader: "País" },
    { field: "email", campoLabel: "Email", type: "string", systemRequired: false, defaultExcelHeader: "Email" },
    { field: "telefono", campoLabel: "Teléfono", type: "string", systemRequired: false, defaultExcelHeader: "Teléfono" },
    { field: "direccion", campoLabel: "Dirección", type: "string", systemRequired: false, defaultExcelHeader: "Dirección" },
  ],
  transportistas: [
    { field: "nombre", campoLabel: "Nombre", type: "string", systemRequired: true, defaultExcelHeader: "Nombre" },
    { field: "idFiscal", campoLabel: "CUIT", type: "string", systemRequired: false, warnIfEmpty: true, defaultExcelHeader: "CUIT" },
    { field: "pais", campoLabel: "País", type: "string", systemRequired: false, warnIfEmpty: true, defaultExcelHeader: "País" },
    { field: "domicilio", campoLabel: "Domicilio", type: "string", systemRequired: false, defaultExcelHeader: "Domicilio" },
    { field: "condicionIva", campoLabel: "Condición IVA", type: "number", systemRequired: false, defaultExcelHeader: "Cond. IVA" },
    { field: "comisionPct", campoLabel: "% Comisión", type: "number", systemRequired: false, defaultExcelHeader: "% Comisión" },
    { field: "paut", campoLabel: "PAUT", type: "string", systemRequired: false, defaultExcelHeader: "PAUT" },
    { field: "permisoInternacional", campoLabel: "Permiso internacional", type: "string", systemRequired: false, defaultExcelHeader: "Permiso internacional" },
    { field: "fechaVencimientoPermiso", campoLabel: "Vto. permiso internacional", type: "date", systemRequired: false, defaultExcelHeader: "Vto. permiso" },
  ],
  choferes: [
    { field: "nombre", campoLabel: "Nombre", type: "string", systemRequired: true, defaultExcelHeader: "Nombre" },
    { field: "dni", campoLabel: "DNI", type: "string", systemRequired: false, defaultExcelHeader: "DNI" },
    { field: "cuit", campoLabel: "CUIT", type: "string", systemRequired: false, defaultExcelHeader: "CUIT" },
    { field: "licencia", campoLabel: "Licencia", type: "string", systemRequired: false, defaultExcelHeader: "Licencia" },
    { field: "licenciaVence", campoLabel: "Vto. licencia", type: "date", systemRequired: false, defaultExcelHeader: "Vto. Licencia" },
    { field: "telefono", campoLabel: "Teléfono", type: "string", systemRequired: false, defaultExcelHeader: "Teléfono" },
    {
      field: "transportistaId",
      campoLabel: "Transporte",
      type: "lookup",
      systemRequired: false,
      defaultExcelHeader: "Transporte",
      lookupModel: "transportistas",
      lookupFields: ["nombre", "idFiscal"],
      createIfNotFoundSoportado: true,
    },
  ],
  vehiculos: [
    { field: "patente", campoLabel: "Patente", type: "string", systemRequired: false, defaultExcelHeader: "Patente" },
    { field: "tipo", campoLabel: "Tipo", type: "string", systemRequired: false, defaultExcelHeader: "Tipo" },
    { field: "marca", campoLabel: "Marca", type: "string", systemRequired: false, defaultExcelHeader: "Marca" },
    { field: "modelo", campoLabel: "Modelo", type: "string", systemRequired: false, defaultExcelHeader: "Modelo" },
    { field: "anio", campoLabel: "Año", type: "number", systemRequired: false, defaultExcelHeader: "Año" },
    { field: "poliza", campoLabel: "Póliza", type: "string", systemRequired: false, defaultExcelHeader: "Póliza" },
    { field: "vencimientoPoliza", campoLabel: "Vto. póliza", type: "date", systemRequired: false, defaultExcelHeader: "Vto. Póliza" },
    {
      field: "transportistaId",
      campoLabel: "Transporte",
      type: "lookup",
      systemRequired: false,
      defaultExcelHeader: "Transporte",
      lookupModel: "transportistas",
      lookupFields: ["nombre", "idFiscal"],
      createIfNotFoundSoportado: true,
    },
  ],
  viajes: [
    { field: "numeroIdentificacionPersonalizado", campoLabel: "ID Personalizado", type: "string", systemRequired: false, defaultExcelHeader: "ID Personalizado" },
    {
      field: "clienteId",
      campoLabel: "Cliente",
      type: "lookup",
      systemRequired: true,
      defaultExcelHeader: "Cliente",
      lookupModel: "clientes",
      lookupFields: ["nombre", "idFiscal"],
      createIfNotFoundSoportado: true,
    },
    {
      field: "transportistaId",
      campoLabel: "Transporte",
      type: "lookup",
      systemRequired: true,
      defaultExcelHeader: "Transporte",
      lookupModel: "transportistas",
      lookupFields: ["nombre", "idFiscal"],
      createIfNotFoundSoportado: true,
    },
    {
      field: "transportistaEfectivoId",
      campoLabel: "Transporte subcontratado",
      type: "lookup",
      systemRequired: false,
      defaultExcelHeader: "Transporte subcontratado",
      lookupModel: "transportistas",
      lookupFields: ["nombre", "idFiscal"],
      createIfNotFoundSoportado: true,
    },
    {
      field: "choferId",
      campoLabel: "Chofer",
      type: "lookup",
      systemRequired: false,
      defaultExcelHeader: "Chofer",
      lookupModel: "choferes",
      lookupFields: ["nombre", "dni"],
      createIfNotFoundSoportado: true,
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
      // Soporta traer más de una patente en la misma celda separadas por "/"
      // (tractor + semirremolque) — se vinculan ambos vehículos al viaje.
      multiple: true,
      separador: "/",
    },
    { field: "origen", campoLabel: "Origen", type: "string", systemRequired: true, defaultExcelHeader: "Origen" },
    { field: "destino", campoLabel: "Destino", type: "string", systemRequired: true, defaultExcelHeader: "Destino" },
    { field: "fechaCarga", campoLabel: "Fecha de carga", type: "date", systemRequired: true, defaultExcelHeader: "Fecha carga" },
    { field: "fechaDescarga", campoLabel: "Fecha de descarga", type: "date", systemRequired: true, defaultExcelHeader: "Fecha descarga" },
    { field: "detalleCarga", campoLabel: "Detalle de carga", type: "string", systemRequired: false, defaultExcelHeader: "Detalle de carga" },
    { field: "kmRecorridos", campoLabel: "Km recorridos", type: "number", systemRequired: false, defaultExcelHeader: "Km recorridos" },
    {
      field: "tipoFlota",
      campoLabel: "Tipo de flota",
      type: "enum",
      systemRequired: false,
      defaultExcelHeader: "Tipo de flota",
      allowedValues: ["PROPIA", "TERCERO"],
    },
    { field: "monto", campoLabel: "Monto total a cliente", type: "number", systemRequired: false, defaultExcelHeader: "Monto total a cliente" },
    { field: "cantidadFactura", campoLabel: "Cantidad a facturar", type: "number", systemRequired: false, defaultExcelHeader: "Cantidad a facturar" },
    { field: "precioUnitarioFactura", campoLabel: "Precio unitario a facturar", type: "number", systemRequired: false, defaultExcelHeader: "Precio unitario a facturar" },
    { field: "nroFactura", campoLabel: "N° factura a cliente", type: "string", systemRequired: false, defaultExcelHeader: "N° factura a cliente" },
    { field: "fechaEmisionFactura", campoLabel: "Fecha emisión factura cliente", type: "date", systemRequired: false, defaultExcelHeader: "Fecha emisión factura cliente" },
    { field: "fechaVencimientoFactura", campoLabel: "Fecha vencimiento factura cliente", type: "date", systemRequired: false, defaultExcelHeader: "Fecha vencimiento factura cliente" },
    { field: "cantidadTransportista", campoLabel: "Cantidad transportista", type: "number", systemRequired: false, defaultExcelHeader: "Cantidad transportista" },
    { field: "precioUnitarioTransportista", campoLabel: "Precio unitario transportista", type: "number", systemRequired: false, defaultExcelHeader: "Precio unitario transportista" },
    { field: "precioTransportistaExterno", campoLabel: "Monto total a transportista (flete)", type: "number", systemRequired: false, defaultExcelHeader: "Monto total a transportista (flete)" },
    { field: "monedaPrecioTransportistaExterno", campoLabel: "Moneda flete", type: "string", systemRequired: false, defaultExcelHeader: "Moneda flete" },
    { field: "observaciones", campoLabel: "Observaciones", type: "string", systemRequired: false, defaultExcelHeader: "Observaciones" },
    { field: "monedaMonto", campoLabel: "Moneda", type: "string", systemRequired: false, defaultExcelHeader: "Moneda" },
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
    { field: "cantidadProducto", campoLabel: "Cantidad de producto", type: "number", systemRequired: false, defaultExcelHeader: "Cantidad de producto" },
  ],
};

/**
 * Config de importación por defecto para un módulo, armada a partir del
 * catálogo fijo (mismos encabezados sugeridos que ve el superadmin al abrir
 * el formulario). Se usa como fallback cuando el tenant todavía no tiene un
 * `ImportTemplate` propio — así ningún módulo queda bloqueado por falta de
 * configuración. Devuelve `null` si el módulo no tiene catálogo definido.
 */
export function construirConfigPorDefecto(modulo: string): TemplateConfig | null {
  const columnas = TEMPLATE_CATALOGO[modulo];
  if (!columnas || columnas.length === 0) return null;

  return {
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
      return col;
    }),
  };
}
