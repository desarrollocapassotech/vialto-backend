export type ModalidadOperacionViaje = 'flota_propia' | 'transporte_externo';

export type ViajeExportacionTipo = 'mic-crt' | 'paut';

export type ViajeExportacionesResponse = {
  viajeId: string;
  viajeNumero: string;
  modalidadOperacion: ModalidadOperacionViaje;
  /** Solo `true` si el viaje tiene transportista externo asignado. */
  puedeExportarPaut: boolean;
  /** Tipos de documento que el menú de exportación debe ofrecer. */
  exportacionesDisponibles: ViajeExportacionTipo[];
};

/** Flota propia = sin `transportistaId`; transporte externo = con transportista asignado. */
export function modalidadOperacionViaje(viaje: {
  transportistaId?: string | null;
}): ModalidadOperacionViaje {
  return viaje.transportistaId?.trim() ? 'transporte_externo' : 'flota_propia';
}

export function viajePuedeExportarPaut(viaje: { transportistaId?: string | null }): boolean {
  return modalidadOperacionViaje(viaje) === 'transporte_externo';
}

export function exportacionesDisponiblesViaje(viaje: {
  transportistaId?: string | null;
}): ViajeExportacionTipo[] {
  const docs: ViajeExportacionTipo[] = ['mic-crt'];
  if (viajePuedeExportarPaut(viaje)) docs.push('paut');
  return docs;
}

export function buildViajeExportacionesResponse(viaje: {
  id: string;
  numero: string;
  transportistaId?: string | null;
}): ViajeExportacionesResponse {
  const modalidadOperacion = modalidadOperacionViaje(viaje);
  return {
    viajeId: viaje.id,
    viajeNumero: viaje.numero,
    modalidadOperacion,
    puedeExportarPaut: modalidadOperacion === 'transporte_externo',
    exportacionesDisponibles: exportacionesDisponiblesViaje(viaje),
  };
}

export function enrichViajeConExportaciones<T extends { transportistaId?: string | null }>(
  viaje: T,
) {
  const modalidadOperacion = modalidadOperacionViaje(viaje);
  return {
    ...viaje,
    modalidadOperacion,
    puedeExportarPaut: modalidadOperacion === 'transporte_externo',
    exportacionesDisponibles: exportacionesDisponiblesViaje(viaje),
  };
}
