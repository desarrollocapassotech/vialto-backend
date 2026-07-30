/**
 * Utilidades operativas y de negocio para la integración ARCA / AFIP.
 */
import { BadRequestException } from '@nestjs/common';

/**
 * NOTA DE DISEÑO: En el modelo de base de datos, `factura.numero` es un campo de texto libre
 * (`String`) sin formato garantizado en el DTO de creación para poder dar soporte a facturas
 * de compras y transportistas con nomenclaturas muy variadas (incluyendo letras, barras o guiones).
 *
 * Como no existe una columna numérica estructurada para el correlativo antes de la emisión,
 * esta función extrae de forma tolerante el sufijo numérico final de la cadena para poder
 * verificar la correlatividad con AFIP durante la emisión.
 *
 * Ejemplos de formatos admitidos:
 *  - "0001-00000045" -> 45
 *  - "FAC/120"       -> 120
 *  - "A-12"          -> 12
 *  - "12345"         -> 12345
 * Retorna NaN si no contiene dígitos al final, es vacío o es nulo.
 *
 * @param numero String que representa el número de factura cargado en el sistema
 * @returns El número secuencial como un entero (number), o NaN si no se pudo parsear.
 */
export function parseNumeroFactura(numero: string): number {
  if (!numero) return NaN;
  const match = numero.trim().match(/\d+$/);
  return match ? Number(match[0]) : NaN;
}

/**
 * Determina el tipo de comprobante CVLP a emitir según la condición frente al IVA del transportista.
 * - 60: Responsable Inscripto (ID: 1)
 * - 61: Monotributista (ID: 6) o Exentos/No Alcanzados
 *
 * @param condicionIva ID de la condición frente al IVA en AFIP
 */
export function getCbteTipoCvlp(condicionIva?: number | null): number {
  if (condicionIva == null) {
    throw new BadRequestException(
      'El transportista no tiene configurada su condición frente al IVA. Actualice sus datos maestros antes de operar.',
    );
  }
  return condicionIva === 1 ? 60 : 61;
}

/**
 * Tipo AFIP de Nota de Crédito asociada a Cuenta de Venta y Líquido Producto.
 * Código 065 — anula un CVLP 060/061 con importes positivos (AFIP no acepta negativos).
 */
export const CBTE_TIPO_NC_CVLP = 65;

/**
 * Tipo de comprobante para anular un CVLP autorizado: siempre NC 065.
 * Se conserva la firma con `condicionIva` por compatibilidad con callers existentes;
 * la NC 065 no se bifurca A/B como el CVLP 60/61.
 */
export function getCbteTipoAnulacionCvlp(condicionIva?: number | null): number {
  if (condicionIva == null) {
    throw new BadRequestException(
      'El transportista no tiene configurada su condición frente al IVA.',
    );
  }
  return CBTE_TIPO_NC_CVLP;
}

/** Normaliza el ambiente ARCA guardado en DB / DTO a los valores canónicos. */
export function normalizeArcaAmbiente(raw: unknown): 'homologacion' | 'produccion' {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (v === 'produccion' || v === 'production' || v === 'prod') {
    return 'produccion';
  }
  return 'homologacion';
}
