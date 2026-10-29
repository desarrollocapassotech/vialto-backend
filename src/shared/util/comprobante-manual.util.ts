import { BadRequestException } from '@nestjs/common';

/**
 * Comprobante cargado a mano en una empresa con ARCA (factura hecha por fuera del sistema,
 * factura del transportista en una liquidación manual): tipo AFIP, punto de venta y número
 * por separado, para poder armar el Libro IVA. Espejo de `lib/comprobanteManual.ts` del front.
 */
export const TIPOS_COMPROBANTE_MANUAL: ReadonlyArray<{ codigo: number; letra: string }> = [
  { codigo: 1, letra: 'A' },
  { codigo: 6, letra: 'B' },
  { codigo: 11, letra: 'C' },
  { codigo: 51, letra: 'M' },
  { codigo: 19, letra: 'E' },
  { codigo: 201, letra: 'FCE A' },
  { codigo: 206, letra: 'FCE B' },
  { codigo: 211, letra: 'FCE C' },
];

export const PTO_VENTA_MAX = 99999;
export const CBTE_NRO_MAX = 99999999;

export interface ComprobanteManual {
  cbteTipo: number;
  ptoVenta: number;
  cbteNro: number;
  /** Número para mostrar, ej. "A 0001-00000123". */
  numero: string;
}

const MSG_INCOMPLETO =
  'Completá tipo, punto de venta y número del comprobante (ej. A 0001-00000123).';

export function letraComprobanteManual(cbteTipo: number): string | null {
  return TIPOS_COMPROBANTE_MANUAL.find((t) => t.codigo === cbteTipo)?.letra ?? null;
}

/** "A 0001-00000123": letra, punto de venta (4 dígitos o más) y número (8 dígitos). */
export function formatNumeroComprobanteManual(
  cbteTipo: number,
  ptoVenta: number,
  cbteNro: number,
): string {
  const letra = letraComprobanteManual(cbteTipo) ?? String(cbteTipo);
  return `${letra} ${String(ptoVenta).padStart(4, '0')}-${String(cbteNro).padStart(8, '0')}`;
}

/**
 * Interpreta un número escrito a mano: "A 0001-00000123", "A-0001-123", "Factura C 00001-00000094",
 * "FCE B 2-15". Devuelve null si no tiene letra, punto de venta y número reconocibles.
 */
export function parsearNumeroComprobante(texto: string | null | undefined): ComprobanteManual | null {
  const limpio = (texto ?? '').trim().replace(/\s+/g, ' ');
  const m = limpio.match(
    /^(?:factura(?:\s+de\s+cr[eé]dito\s+electr[oó]nica)?\s+|fac\.?\s+)?(fce\s*)?([abcme])\s*[-\s]?\s*(\d{1,5})\s*-\s*(\d{1,8})$/i,
  );
  if (!m) return null;
  const letra = `${m[1] ? 'FCE ' : ''}${m[2].toUpperCase()}`;
  const tipo = TIPOS_COMPROBANTE_MANUAL.find((t) => t.letra === letra);
  const ptoVenta = Number(m[3]);
  const cbteNro = Number(m[4]);
  if (!tipo || ptoVenta < 1 || cbteNro < 1) return null;
  return {
    cbteTipo: tipo.codigo,
    ptoVenta,
    cbteNro,
    numero: formatNumeroComprobanteManual(tipo.codigo, ptoVenta, cbteNro),
  };
}

function esEnteroEnRango(n: unknown, max: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;
}

/**
 * Valida y arma el comprobante manual. Si vienen los campos por separado se usan esos;
 * si no, se interpreta el número escrito (camino de Cuenta corriente y "Adjuntar comprobante",
 * que solo mandan texto). Obligatorio: sin datos válidos tira BadRequest.
 */
export function resolverComprobanteManual(input: {
  cbteTipo?: number | null;
  ptoVenta?: number | null;
  cbteNro?: number | null;
  numero?: string | null;
}): ComprobanteManual {
  const vienenSeparados =
    input.cbteTipo != null || input.ptoVenta != null || input.cbteNro != null;
  if (!vienenSeparados) {
    const parseado = parsearNumeroComprobante(input.numero);
    if (!parseado) throw new BadRequestException(MSG_INCOMPLETO);
    return parseado;
  }
  if (input.cbteTipo == null || input.ptoVenta == null || input.cbteNro == null) {
    throw new BadRequestException(MSG_INCOMPLETO);
  }
  if (!letraComprobanteManual(input.cbteTipo)) {
    throw new BadRequestException('Elegí un tipo de comprobante válido.');
  }
  if (!esEnteroEnRango(input.ptoVenta, PTO_VENTA_MAX)) {
    throw new BadRequestException(`El punto de venta tiene que ser un número entre 1 y ${PTO_VENTA_MAX}.`);
  }
  if (!esEnteroEnRango(input.cbteNro, CBTE_NRO_MAX)) {
    throw new BadRequestException(`El número de comprobante tiene que ser un número entre 1 y ${CBTE_NRO_MAX}.`);
  }
  return {
    cbteTipo: input.cbteTipo,
    ptoVenta: input.ptoVenta,
    cbteNro: input.cbteNro,
    numero: formatNumeroComprobanteManual(input.cbteTipo, input.ptoVenta, input.cbteNro),
  };
}
