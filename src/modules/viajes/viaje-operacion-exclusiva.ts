import { BadRequestException } from '@nestjs/common';
import { normalizarVehiculoIds } from './viaje-vehiculos.helper';

/** Transportista externo XOR (chofer + al menos un vehículo propio). */
export function assertViajeOperacionExclusiva(refs: {
  transportistaId?: string | null;
  choferId?: string | null;
  vehiculoIds: string[];
}): void {
  const t = refs.transportistaId?.trim() ?? '';
  const ch = refs.choferId?.trim() ?? '';
  const vids = refs.vehiculoIds ?? [];

  if (t) {
    if (ch || vids.length > 0) {
      throw new BadRequestException(
        'Con transportista externo no debe indicar chofer ni vehículos.',
      );
    }
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

  if (transportistaId) {
    choferId = null;
    vehiculoIds = [];
  } else {
    transportistaId = null;
  }

  const merged = { transportistaId, choferId, vehiculoIds };
  assertViajeOperacionExclusiva(merged);
  return merged;
}
