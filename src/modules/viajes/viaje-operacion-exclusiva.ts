import { BadRequestException } from '@nestjs/common';
import { normalizarVehiculoIds } from './viaje-vehiculos.helper';

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
