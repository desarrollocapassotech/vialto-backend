/**
 * De dónde sale una lectura de km. Abierto a propósito (`'telemetria'` a futuro): ningún
 * consumidor debería decidir nada según la fuente, salvo para mostrarla.
 */
export type FuenteKm = 'carga' | 'edicion' | 'orden_trabajo' | 'vehiculo' | (string & {});

export interface LecturaKm {
  km: number;
  fecha: Date;
  fuente: FuenteKm;
  /** Id del registro de origen (carga, edición, OT o el propio vehículo en el fallback). */
  fuenteId: string;
  /** Solo para desempatar el orden; los consumidores pueden ignorarlo. */
  createdAt: Date;
}

export interface RangoLecturas {
  desde?: Date;
  hasta?: Date;
}
