import { randomBytes } from 'node:crypto';

export const LOTE_INTERNO_PREFIX = 'INT-';

const LOTE_INTERNO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function isLoteInterno(lote: string | null | undefined): boolean {
  return typeof lote === 'string' && lote.startsWith(LOTE_INTERNO_PREFIX);
}

/** Genera un identificador único para partidas sin lote de fábrica (ej. INT-A1B2C). */
export function generarLoteInterno(): string {
  const bytes = randomBytes(5);
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += LOTE_INTERNO_ALPHABET[bytes[i]! % LOTE_INTERNO_ALPHABET.length];
  }
  return `${LOTE_INTERNO_PREFIX}${suffix}`;
}

/** Resuelve el lote a persistir en un ingreso (genera lote interno si no hay lote de fábrica). */
export function resolverLoteIngreso(linea: { sinLote?: boolean; lote?: string }): string {
  if (linea.sinLote) {
    return generarLoteInterno();
  }
  return linea.lote!.trim();
}
