/**
 * Plantillas sugeridas que carga `POST mantenimiento/planes/plantillas` (onboarding).
 * Todas sin tipo de vehículo (el cliente elige qué unidades asigna) y, salvo las que la spec
 * trae con anticipación, sin aviso — decisiones de Elias, oct 2026. El cliente las edita
 * libremente después. Idempotentes por nombre (sin distinguir mayúsculas).
 */
export interface PlantillaPlan {
  nombre: string;
  categoria: 'mecanico' | 'documental';
  intervaloKm: number | null;
  intervaloDias: number | null;
  avisoKm: number | null;
  avisoDias: number | null;
  tareas: string[];
}

export const PLANTILLAS_PLAN: readonly PlantillaPlan[] = [
  // Tractor / camión
  { nombre: 'Service motor (aceite + filtros)', categoria: 'mecanico', intervaloKm: 20_000, intervaloDias: 180, avisoKm: 2_000, avisoDias: 15, tareas: ['cambio_aceite_motor', 'revision_filtros'] },
  { nombre: 'Engrase de chasis', categoria: 'mecanico', intervaloKm: 10_000, intervaloDias: 30, avisoKm: null, avisoDias: null, tareas: ['engrasado_chasis'] },
  { nombre: 'Alineación y balanceo', categoria: 'mecanico', intervaloKm: 40_000, intervaloDias: null, avisoKm: null, avisoDias: null, tareas: ['alineacion_balanceo'] },
  // Utilitario
  { nombre: 'Service', categoria: 'mecanico', intervaloKm: 10_000, intervaloDias: 365, avisoKm: null, avisoDias: null, tareas: ['cambio_aceite_motor', 'revision_filtros'] },
  // Semirremolque
  {
    nombre: 'Revisión de frenos y quinta rueda / perno rey',
    categoria: 'mecanico',
    intervaloKm: null,
    intervaloDias: 90,
    avisoKm: null,
    avisoDias: null,
    tareas: ['revision_balatas_pastillas', 'mantenimiento_sistema_aire', 'mantenimiento_quinta_rueda', 'revision_perno_rey'],
  },
  { nombre: 'Engrase', categoria: 'mecanico', intervaloKm: null, intervaloDias: 30, avisoKm: null, avisoDias: null, tareas: ['engrasado_chasis'] },
  // Documentales, cualquier tipo
  { nombre: 'VTV/RTO', categoria: 'documental', intervaloKm: null, intervaloDias: 365, avisoKm: null, avisoDias: 30, tareas: [] },
  { nombre: 'Póliza de seguro', categoria: 'documental', intervaloKm: null, intervaloDias: 365, avisoKm: null, avisoDias: 15, tareas: [] },
  { nombre: 'RUTA', categoria: 'documental', intervaloKm: null, intervaloDias: 365, avisoKm: null, avisoDias: 30, tareas: [] },
];
