import { BadRequestException } from '@nestjs/common';
import { normalizarVehiculoIds } from './viaje-vehiculos.helper';

/**
 * ¿El transportista contratante realiza el flete?
 * Si hay transportista efectivo en el PATCH o en BD → false (subcontratación).
 */
export function resolveContratanteRealizaFlete(args: {
  flag?: boolean;
  transportistaEfectivoIdInDto?: string | null;
  currentTransportistaEfectivoId?: string | null;
  hasTransportistaExterno: boolean;
}): boolean {
  if (!args.hasTransportistaExterno) return true;
  if (args.flag === true || args.flag === false) return args.flag;
  if (args.transportistaEfectivoIdInDto !== undefined) {
    return !(args.transportistaEfectivoIdInDto ?? '').trim();
  }
  const tieneEfectivo = !!((args.currentTransportistaEfectivoId ?? '').trim());
  return !tieneEfectivo;
}

export function resolveTransportistaEfectivoIdPersist(args: {
  hasTransportistaExterno: boolean;
  contratanteRealizaFlete: boolean;
  transportistaEfectivoIdInDto?: string | null;
  currentTransportistaEfectivoId?: string | null;
}): string | null {
  if (!args.hasTransportistaExterno) return null;
  if (args.contratanteRealizaFlete) return null;
  if (args.transportistaEfectivoIdInDto !== undefined) {
    const te = (args.transportistaEfectivoIdInDto ?? '').trim();
    return te || null;
  }
  return (args.currentTransportistaEfectivoId ?? '').trim() || null;
}

/** Con transportista externo, chofer y vehículo son opcionales. Sin transportista externo, ambos son obligatorios. */
export function assertViajeOperacionExclusiva(refs: {
  transportistaId?: string | null;
  choferId?: string | null;
  vehiculoIds: string[];
}): void {
  const t = refs.transportistaId?.trim() ?? '';
  const ch = refs.choferId?.trim() ?? '';
  const vids = refs.vehiculoIds ?? [];

  if (t) {
    return;
  }
  if (!ch || vids.length === 0) {
    throw new BadRequestException(
      'Sin transportista externo, debés indicar chofer y al menos un vehículo.',
    );
  }
}

/**
 * Subcontratación del flete: si el contratante no realiza el flete (`contratanteRealizaFlete === false`),
 * el transportista efectivo es obligatorio y debe ser distinto del contratante.
 */
export function assertTransportistaEfectivoSubcontratacion(args: {
  transportistaId?: string | null;
  transportistaEfectivoId?: string | null;
  /** Por defecto true (el contratante realiza el flete) si se omite. */
  contratanteRealizaFlete?: boolean;
}): void {
  const contratante = args.transportistaId?.trim() ?? '';
  if (!contratante) return;

  const contratanteRealiza = args.contratanteRealizaFlete !== false;
  if (contratanteRealiza) return;

  const efectivo = args.transportistaEfectivoId?.trim() ?? '';
  if (!efectivo) {
    throw new BadRequestException(
      'Campo obligatorio: seleccioná el transportista que realiza el flete.',
    );
  }
  if (efectivo === contratante) {
    throw new BadRequestException(
      'El transportista que realiza el flete debe ser distinto del contratante.',
    );
  }
}

function toNullId(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Combina estado actual + PATCH y aplica reglas de exclusión. */
export function mergeViajeOperacionIds(
  current: {
    transportistaId: string | null;
    choferId: string | null;
    vehiculoIds: string[];
  },
  dto: {
    transportistaId?: string | null;
    choferId?: string | null;
    vehiculoIds?: string[] | null;
  },
): {
  transportistaId: string | null;
  choferId: string | null;
  vehiculoIds: string[];
} {
  let transportistaId =
    dto.transportistaId !== undefined
      ? toNullId(dto.transportistaId)
      : toNullId(current.transportistaId);
  let choferId =
    dto.choferId !== undefined ? toNullId(dto.choferId) : toNullId(current.choferId);
  let vehiculoIds =
    dto.vehiculoIds !== undefined
      ? normalizarVehiculoIds(dto.vehiculoIds)
      : [...current.vehiculoIds];

  if (!transportistaId) {
    transportistaId = null;
  }

  const merged = { transportistaId, choferId, vehiculoIds };
  assertViajeOperacionExclusiva(merged);
  return merged;
}
