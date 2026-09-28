/**
 * - activo: CUIT activo, constancia OK → se autocompleta nombre y domicilio.
 * - con_observaciones: existe pero ARCA no emite la constancia (ej. requerimientos
 *   pendientes); se considera aceptable y solo trae nombre, sin domicilio.
 * - inactivo: la clave no está ACTIVA en ARCA (rechazado) → no se autocompleta.
 * - no_encontrado: el CUIT no existe en el padrón.
 */
export type PadronEstado = 'activo' | 'con_observaciones' | 'inactivo' | 'no_encontrado';

export interface PadronConsulta {
  cuit: string;
  estado: PadronEstado;
  /** Razón social, o "APELLIDO NOMBRE" para personas humanas, tal cual figura en ARCA. */
  nombre: string | null;
  /** Domicilio fiscal: "dirección, localidad, provincia". */
  domicilio: string | null;
  /** Mismo código que Cliente/Transportista.condicionIva (1 RI, 4 Exento, 6 Monotributo); null si no se infiere. */
  condicionIva: number | null;
  observaciones: string[];
}
