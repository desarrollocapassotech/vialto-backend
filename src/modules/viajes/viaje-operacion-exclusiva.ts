import { BadRequestException } from '@nestjs/common';

/** Transportista externo XOR (chofer + vehículo propio). */
export function assertViajeOperacionExclusiva(refs: {
  transportistaId?: string | null;
  choferId?: string | null;
  vehiculoId?: string | null;
}): void {
  const t = refs.transportistaId?.trim() ?? '';
  const ch = refs.choferId?.trim() ?? '';
  const vh = refs.vehiculoId?.trim() ?? '';

  if (t) {
    if (ch || vh) {
      throw new BadRequestException(
        'Con transportista externo no debe indicar chofer ni vehículo.',
      );
    }
    return;
  }
  if (!ch || !vh) {
    throw new BadRequestException(
      'Sin transportista externo, debés indicar chofer y vehículo.',
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
    vehiculoId: string | null;
  },
  dto: {
    transportistaId?: string | null;
    choferId?: string | null;
    vehiculoId?: string | null;
  },
): { transportistaId: string | null; choferId: string | null; vehiculoId: string | null } {
  let transportistaId =
    dto.transportistaId !== undefined
      ? toNullId(dto.transportistaId)
      : toNullId(current.transportistaId);
  let choferId =
    dto.choferId !== undefined ? toNullId(dto.choferId) : toNullId(current.choferId);
  let vehiculoId =
    dto.vehiculoId !== undefined ? toNullId(dto.vehiculoId) : toNullId(current.vehiculoId);

  if (transportistaId) {
    choferId = null;
    vehiculoId = null;
  } else {
    transportistaId = null;
  }

  const merged = { transportistaId, choferId, vehiculoId };
  assertViajeOperacionExclusiva(merged);
  return merged;
}
