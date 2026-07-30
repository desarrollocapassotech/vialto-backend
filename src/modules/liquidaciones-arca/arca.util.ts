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
 * Tipo de comprobante para anular un CVLP.
 * AFIP no admite ImpNeto/ImpIVA/ImpTotal &lt; 0 en tipos 60/61; la anulación
 * se hace con Liquidación de Ajuste (importes en positivo; el tipo invierte el efecto):
 * - 63: Ajuste Cuenta de Venta y Líquido Producto A (anula 60)
 * - 64: Ajuste Cuenta de Venta y Líquido Producto B (anula 61)
 */
export function getCbteTipoAnulacionCvlp(condicionIva?: number | null): number {
  if (condicionIva == null) {
    throw new BadRequestException(
      'El transportista no tiene configurada su condición frente al IVA.',
    );
  }
  return condicionIva === 1 ? 63 : 64;
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
