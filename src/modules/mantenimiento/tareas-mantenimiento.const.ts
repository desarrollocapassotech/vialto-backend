/**
 * Catálogo de tareas de mantenimiento válidas (`PlanMantenimiento.tareas`,
 * `OrdenTrabajo.tareas`), agrupado por sistema del vehículo.
 * Debe reflejar el mismo catálogo que el frontend (vialto-frontend/src/lib/mantenimientoLabels.ts;
 * se renombra en MANT-04) — no hay paquete compartido entre backend y frontend, así que se
 * mantiene duplicado a propósito (mismo criterio que el resto de los enums de este módulo).
 */
export const TAREAS_MANTENIMIENTO_VALIDAS = [
  // Motor y sistema de propulsión
  'cambio_aceite_motor',
  'revision_filtros',
  'inspeccion_bandas_correas',
  'calibracion_valvulas',
  'revision_inyectores',
  'inspeccion_turbocompresor',
  // Sistema de frenos
  'revision_balatas_pastillas',
  'rectificacion_tambores_discos',
  'mantenimiento_sistema_aire',
  'prueba_camaras_freno',
  'ajuste_matracas',
  // Tren motriz, suspensión y dirección
  'servicio_transmision',
  'servicio_diferencial',
  'engrasado_chasis',
  'alineacion_balanceo',
  'revision_suspension',
  'inspeccion_rodamientos',
  // Sistema eléctrico y electrónico
  'diagnostico_escaner',
  'prueba_baterias',
  'control_alternador',
  'inspeccion_luces',
  // Sistema de carga y acople
  'mantenimiento_quinta_rueda',
  'revision_perno_rey',
  'inspeccion_lineas_acople',
  // Neumáticos
  'rotacion_cubiertas',
  'cambio_cubiertas',
  'reparacion_pinchadura',
  // Catch-all
  'otro',
] as const;

/**
 * Nombres para mostrar, agrupados por sistema. Hoy lo usa solo la app del chofer (la recibe en
 * `GET mantenimiento/chofer/contexto`, así esa app no guarda otra copia). Mismos textos que
 * `TAREAS_CATALOGO` del frontend: si se cambia uno, cambiar el otro.
 */
export const TAREAS_MANTENIMIENTO_GRUPOS: { grupo: string; tareas: { value: (typeof TAREAS_MANTENIMIENTO_VALIDAS)[number]; label: string }[] }[] = [
  {
    grupo: 'Motor y sistema de propulsión',
    tareas: [
      { value: 'cambio_aceite_motor', label: 'Cambio de aceite de motor' },
      { value: 'revision_filtros', label: 'Revisión de filtros' },
      { value: 'inspeccion_bandas_correas', label: 'Inspección de bandas y correas' },
      { value: 'calibracion_valvulas', label: 'Calibración de válvulas' },
      { value: 'revision_inyectores', label: 'Revisión de inyectores' },
      { value: 'inspeccion_turbocompresor', label: 'Inspección del turbocompresor' },
    ],
  },
  {
    grupo: 'Sistema de frenos',
    tareas: [
      { value: 'revision_balatas_pastillas', label: 'Revisión de balatas y pastillas' },
      { value: 'rectificacion_tambores_discos', label: 'Rectificación de tambores y discos' },
      { value: 'mantenimiento_sistema_aire', label: 'Mantenimiento del sistema de aire' },
      { value: 'prueba_camaras_freno', label: 'Prueba de cámaras de freno' },
      { value: 'ajuste_matracas', label: 'Ajuste de matracas' },
    ],
  },
  {
    grupo: 'Tren motriz, suspensión y dirección',
    tareas: [
      { value: 'servicio_transmision', label: 'Servicio de transmisión' },
      { value: 'servicio_diferencial', label: 'Servicio de diferencial' },
      { value: 'engrasado_chasis', label: 'Engrasado de chasis' },
      { value: 'alineacion_balanceo', label: 'Alineación y balanceo' },
      { value: 'revision_suspension', label: 'Revisión de suspensión' },
      { value: 'inspeccion_rodamientos', label: 'Inspección de rodamientos' },
    ],
  },
  {
    grupo: 'Sistema eléctrico y electrónico',
    tareas: [
      { value: 'diagnostico_escaner', label: 'Diagnóstico por escáner' },
      { value: 'prueba_baterias', label: 'Prueba de baterías' },
      { value: 'control_alternador', label: 'Control del alternador' },
      { value: 'inspeccion_luces', label: 'Inspección de luces' },
    ],
  },
  {
    grupo: 'Sistema de carga y acople',
    tareas: [
      { value: 'mantenimiento_quinta_rueda', label: 'Mantenimiento de quinta rueda' },
      { value: 'revision_perno_rey', label: 'Revisión de perno rey' },
      { value: 'inspeccion_lineas_acople', label: 'Inspección de líneas de acople' },
    ],
  },
  {
    grupo: 'Neumáticos',
    tareas: [
      { value: 'rotacion_cubiertas', label: 'Rotación de cubiertas' },
      { value: 'cambio_cubiertas', label: 'Cambio de cubiertas' },
      { value: 'reparacion_pinchadura', label: 'Reparación de pinchadura' },
    ],
  },
  { grupo: 'Otro', tareas: [{ value: 'otro', label: 'Otro' }] },
];
