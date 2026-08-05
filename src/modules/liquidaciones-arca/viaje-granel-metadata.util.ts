export type ViajeGranelMetadata = {
  tnOrigen: number | null;
  tnDestino: number | null;
  tarifaAplicada: number | null;
  tarifaMinima: number | null;
  grano: string | null;
  ctg: string | null;
  cartaDePorte: string | null;
};

function coerceNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Lee campos de granel desde metadata del viaje (acepta alias tarifaPorTn / tarifaTransportista). */
export function parseViajeGranelMetadata(metadata: unknown): ViajeGranelMetadata {
  const meta =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : {};

  return {
    tnOrigen: coerceNumber(meta.tnOrigen),
    tnDestino: coerceNumber(meta.tnDestino),
    tarifaAplicada: coerceNumber(meta.tarifaTransportista ?? meta.tarifaPorTn),
    tarifaMinima: coerceNumber(meta.tarifaMinima ?? meta.tarifaMin),
    grano: typeof meta.grano === 'string' ? meta.grano : null,
    ctg: typeof meta.ctg === 'string' ? meta.ctg : null,
    cartaDePorte: typeof meta.cartaDePorte === 'string' ? meta.cartaDePorte : null,
  };
}
