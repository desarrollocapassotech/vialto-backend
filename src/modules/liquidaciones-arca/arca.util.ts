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
 * Código 065 (NC de Líquido Producto). AFIP NO lo habilita por web service
 * (FEParamGetTiposCbte no lo lista; rechaza con 11001). Se conserva solo para
 * detección/compatibilidad en el PDF de anulaciones históricas.
 */
export const CBTE_TIPO_NC_CVLP = 65;

export type TipoAnulacionCvlp = 'nota_credito' | 'nota_debito';

/**
 * Tipo de comprobante para anular un CVLP autorizado.
 * AFIP no acepta el 065 ni importes negativos por web service, así que el CVLP se
 * anula con un comprobante ESTÁNDAR asociado (CbtesAsoc) al 060/061 original.
 * El comprobante (Nota de Crédito o Nota de Débito) es configurable por tenant;
 * la clase A/B se deriva de la condición frente al IVA del transportista.
 * Verificado contra AFIP (homologación): los 4 tipos son aceptados y devuelven CAE.
 *   - Nota de Crédito:  clase A → tipo 3,  clase B → tipo 8.
 *   - Nota de Débito:   clase A → tipo 2,  clase B → tipo 7.
 */
export function getCbteTipoAnulacionCvlp(
  condicionIva?: number | null,
  tipoAnulacion: TipoAnulacionCvlp = 'nota_credito',
): number {
  if (condicionIva == null) {
    throw new BadRequestException(
      'El transportista no tiene configurada su condición frente al IVA.',
    );
  }
  const claseA = condicionIva === 1;
  if (tipoAnulacion === 'nota_debito') {
    return claseA ? 2 : 7; // Nota de Débito A / B
  }
  return claseA ? 3 : 8; // Nota de Crédito A / B
}

/** true si el cbteTipo de anulación (2/3/7/8) corresponde a una Nota de Débito. */
export function esNotaDebitoAnulacion(cbteTipo?: number | null): boolean {
  return cbteTipo === 2 || cbteTipo === 7;
}

/**
 * CUIT de prueba estándar para homologación (usado ya en scripts/test-*.js de este repo).
 * AFIP SDK maneja este CUIT en su sandbox sin necesidad de certificado propio: en
 * homologación se usa este CUIT en vez del CUIT real del emisor — el certificado real
 * (o el autofirmado que registre cada tenant) queda reservado para producción.
 */
export const CUIT_TEST_HOMOLOGACION = '20409378472';

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

/**
 * Determina el tipo de Factura A/B según la condición frente al IVA del cliente.
 * - 1: Responsable Inscripto → Factura A (cbteTipo 1)
 * - Resto (monotributo, CF, exento, etc.) → Factura B (cbteTipo 6)
 */
export function getCbteTipoFactura(condicionIva?: number | null): number {
  if (condicionIva == null) {
    throw new BadRequestException(
      'El cliente no tiene configurada su condición frente al IVA. Actualice sus datos maestros antes de operar.',
    );
  }
  return condicionIva === 1 ? 1 : 6;
}
