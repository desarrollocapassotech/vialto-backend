/**
 * Catálogo de tipos de intervención válidos, agrupado por sistema del vehículo.
 * Debe reflejar el mismo catálogo que `TIPO_INTERVENCION_CATEGORIAS` en el frontend
 * (vialto-frontend/src/lib/mantenimientoLabels.ts) — no hay paquete compartido entre
 * backend y frontend, así que se mantiene duplicado a propósito (mismo criterio que el
 * resto de los enums de este módulo).
 */
export const TIPOS_INTERVENCION_VALIDOS = [
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
