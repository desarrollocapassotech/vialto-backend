export type CampoCatalogo = {
  campo: string;
  label: string;
  obligatorioSistema: boolean;
};

export type FormularioCatalogo = {
  label: string;
  campos: CampoCatalogo[];
};

export type ModuloCatalogo = {
  label: string;
  formularios: Record<string, FormularioCatalogo>;
};

export const FIELD_CATALOG: Record<string, ModuloCatalogo> = {
  viajes: {
    label: "Viajes",
    formularios: {
      alta_viaje: {
        label: "Alta de viaje",
        campos: [
          { campo: "estado", label: "Estado", obligatorioSistema: true },
          { campo: "clienteId", label: "Cliente", obligatorioSistema: true },
          { campo: "monto", label: "Monto a facturar", obligatorioSistema: true },
          { campo: "origen", label: "Origen", obligatorioSistema: true },
          { campo: "destinosRows", label: "Destinos", obligatorioSistema: true },
          { campo: "transportistaId", label: "Transportista externo", obligatorioSistema: false },
          { campo: "precioTransportistaExterno", label: "Precio transporte", obligatorioSistema: false },
          { campo: "realizaFlete", label: "¿Realiza el flete?", obligatorioSistema: false },
          { campo: "transportistaEfectivoId", label: "Transportista que realiza el flete", obligatorioSistema: false },
          { campo: "choferId", label: "Chofer (flota propia)", obligatorioSistema: false },
          { campo: "choferExternoId", label: "Chofer (externo)", obligatorioSistema: false },
          { campo: "vehiculosRows", label: "Vehículos", obligatorioSistema: false },
          { campo: "fechaCarga", label: "Fecha de carga", obligatorioSistema: true },
          { campo: "fechaDescarga", label: "Fecha de descarga", obligatorioSistema: true },
          { campo: "productoItems", label: "Productos", obligatorioSistema: false },
          { campo: "detalleCarga", label: "Detalle adicional", obligatorioSistema: false },
          { campo: "observaciones", label: "Observaciones", obligatorioSistema: false },
          { campo: "kmRecorridos", label: "Km recorridos", obligatorioSistema: false },
          { campo: "litrosConsumidos", label: "Litros consumidos", obligatorioSistema: false },
          { campo: "gananciaBrutaManual", label: "Ganancia bruta manual", obligatorioSistema: false },
          { campo: "otrosGastos", label: "Otros gastos", obligatorioSistema: false },
          { campo: "pagosTransportista", label: "Pagos al transportista", obligatorioSistema: false },
        ],
      },
      edicion_viaje: {
        label: "Edición de viaje",
        campos: [
          { campo: "estado", label: "Estado", obligatorioSistema: true },
          { campo: "clienteId", label: "Cliente", obligatorioSistema: true },
          { campo: "monto", label: "Monto a facturar", obligatorioSistema: true },
          { campo: "origen", label: "Origen", obligatorioSistema: true },
          { campo: "destinosRows", label: "Destinos", obligatorioSistema: true },
          { campo: "transportistaId", label: "Transportista externo", obligatorioSistema: false },
          { campo: "precioTransportistaExterno", label: "Precio transporte", obligatorioSistema: false },
          { campo: "realizaFlete", label: "¿Realiza el flete?", obligatorioSistema: false },
          { campo: "transportistaEfectivoId", label: "Transportista que realiza el flete", obligatorioSistema: false },
          { campo: "choferId", label: "Chofer (flota propia)", obligatorioSistema: false },
          { campo: "choferExternoId", label: "Chofer (externo)", obligatorioSistema: false },
          { campo: "vehiculosRows", label: "Vehículos", obligatorioSistema: false },
          { campo: "fechaCarga", label: "Fecha de carga", obligatorioSistema: true },
          { campo: "fechaDescarga", label: "Fecha de descarga", obligatorioSistema: true },
          { campo: "productoItems", label: "Productos", obligatorioSistema: false },
          { campo: "detalleCarga", label: "Detalle adicional", obligatorioSistema: false },
          { campo: "observaciones", label: "Observaciones", obligatorioSistema: false },
          { campo: "kmRecorridos", label: "Km recorridos", obligatorioSistema: false },
          { campo: "litrosConsumidos", label: "Litros consumidos", obligatorioSistema: false },
          { campo: "gananciaBrutaManual", label: "Ganancia bruta manual", obligatorioSistema: false },
          { campo: "otrosGastos", label: "Otros gastos", obligatorioSistema: false },
          { campo: "pagosTransportista", label: "Pagos al transportista", obligatorioSistema: false },
        ],
      },
      detalle_viaje: {
        label: "Detalle de viaje",
        campos: [
          { campo: "clienteId", label: "Cliente", obligatorioSistema: true },
          { campo: "transportistaId", label: "Transportista", obligatorioSistema: false },
          { campo: "origen", label: "Ruta (origen/destinos)", obligatorioSistema: true },
          { campo: "fechaCarga", label: "Fecha de carga", obligatorioSistema: false },
          { campo: "fechaDescarga", label: "Fecha de descarga", obligatorioSistema: false },
          { campo: "vehiculosRows", label: "Vehículos", obligatorioSistema: false },
          { campo: "productoItems", label: "Productos", obligatorioSistema: false },
          { campo: "monto", label: "Monto cliente", obligatorioSistema: false },
          { campo: "precioTransportistaExterno", label: "Precio transportista", obligatorioSistema: false },
          { campo: "kmRecorridos", label: "Km recorridos", obligatorioSistema: false },
          { campo: "litrosConsumidos", label: "Litros consumidos", obligatorioSistema: false },
          { campo: "detalleCarga", label: "Detalle de carga", obligatorioSistema: false },
          { campo: "observaciones", label: "Observaciones", obligatorioSistema: false },
          { campo: "otrosGastos", label: "Gastos adicionales", obligatorioSistema: false },
          { campo: "pagosTransportista", label: "Pagos al transportista", obligatorioSistema: false },
        ],
      },
    },
  },
};

export function getCatalogoFormulario(modulo: string, formulario: string): CampoCatalogo[] {
  return FIELD_CATALOG[modulo]?.formularios?.[formulario]?.campos ?? [];
}

export function getCatalogoModulo(modulo: string): Record<string, FormularioCatalogo> {
  return FIELD_CATALOG[modulo]?.formularios ?? {};
}