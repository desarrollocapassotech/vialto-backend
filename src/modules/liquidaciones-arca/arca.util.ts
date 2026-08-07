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
 * Determina el tipo de comprobante CVLP a emitir.
 * Siempre 60 (clase A): AFIP rechaza la emisión del 061 (clase B) por web service
 * en la práctica, así que se dejó de emitir — ver "Gotchas operativos de ARCA" en CLAUDE.md.
 * Se mantiene la exigencia de condición IVA cargada porque el resto del flujo
 * (anulación, Facturas A/B) sigue dependiendo de ese dato.
 *
 * @param condicionIva ID de la condición frente al IVA en AFIP
 */
export function getCbteTipoCvlp(condicionIva?: number | null): number {
  if (condicionIva == null) {
    throw new BadRequestException(
      'El transportista no tiene configurada su condición frente al IVA. Actualice sus datos maestros antes de operar.',
    );
  }
  return 60;
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

/**
 * CUIT receptor de prueba en homologación (scripts/test-*.js).
 * Está en el padrón del entorno de pruebas de AFIP.
 */
export const CUIT_RECEPTOR_TEST_HOMOLOGACION = 30668346908;

const DOC_TIPO_CUIT = 80;
const DOC_TIPO_CF = 99;

export type ReceptorAfip = {
  docTipo: number;
  docNro: number;
  condicionIvaReceptorId: number;
};

/** true si el cbteTipo pertenece a la clase A (Factura/CVLP/NC/ND A). */
export function esCbteTipoClaseA(cbteTipo: number): boolean {
  return cbteTipo === 1 || cbteTipo === 2 || cbteTipo === 3 || cbteTipo === 60;
}

/**
 * DocTipo / DocNro / Condición IVA del receptor para WSFE.
 * Homologación: los CUIT reales no están en el padrón de AFIP — se usan valores de prueba
 * (Factura B → CF 99/0; clase A y CVLP B → CUIT 30668346908).
 */
export function resolveReceptorAfip(args: {
  ambiente: 'homologacion' | 'produccion';
  cbteTipo: number;
  docNroReal: number;
  condicionIvaReceptorId: number;
}): ReceptorAfip {
  if (normalizeArcaAmbiente(args.ambiente) === 'produccion') {
    return {
      docTipo: args.docNroReal ? DOC_TIPO_CUIT : DOC_TIPO_CF,
      docNro: args.docNroReal,
      condicionIvaReceptorId: args.condicionIvaReceptorId,
    };
  }

  if (esCbteTipoClaseA(args.cbteTipo)) {
    return {
      docTipo: DOC_TIPO_CUIT,
      docNro: CUIT_RECEPTOR_TEST_HOMOLOGACION,
      condicionIvaReceptorId: 1,
    };
  }

  // Factura B: consumidor final (Doc 99/0) — patrón oficial AfipSDK en homologación.
  if (args.cbteTipo === 6) {
    return {
      docTipo: DOC_TIPO_CF,
      docNro: 0,
      condicionIvaReceptorId: 5,
    };
  }

  // CVLP B (61), NC/ND B (7/8): CUIT de prueba + condición del receptor real.
  return {
    docTipo: DOC_TIPO_CUIT,
    docNro: CUIT_RECEPTOR_TEST_HOMOLOGACION,
    condicionIvaReceptorId: args.condicionIvaReceptorId || 6,
  };
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

/**
 * Nota de Crédito que anula una Factura A/B.
 * Factura A (01) → NC A (03); Factura B (06) → NC B (08).
 * Misma correspondencia de clase que la anulación de CVLP (3/8).
 * Si se pasa el cbteTipo original (1/6), se usa eso; si no, se deriva de la
 * condición IVA del cliente.
 */
export function getCbteTipoAnulacionFactura(
  cbteTipoOriginal?: number | null,
  condicionIvaCliente?: number | null,
): number {
  if (cbteTipoOriginal === 1 || cbteTipoOriginal === 3) return 3;
  if (cbteTipoOriginal === 6 || cbteTipoOriginal === 8) return 8;
  if (condicionIvaCliente == null) {
    throw new BadRequestException(
      'No se puede determinar el tipo de Nota de Crédito: falta cbteTipo de la factura y condición IVA del cliente.',
    );
  }
  return condicionIvaCliente === 1 ? 3 : 8;
}

/** Fecha yyyymmdd para AFIP en UTC (alineado con scripts/test-*.js). */
export function formatFechaCbteUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Fecha yyyymmdd en zona horaria Argentina (AFIP opera en hora local). */
export function formatFechaCbteArgentina(date: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
  return ymd.replace(/-/g, '');
}

/**
 * Fecha de comprobante a enviar a AFIP.
 * Homologación: hoy (ARG y UTC, el mayor) y nunca anterior al último comprobante autorizado.
 * Producción: fecha de emisión, sin futuro.
 */
export function resolveFechaCbteEmision(
  ambiente: 'homologacion' | 'produccion',
  fechaEmision: Date,
  ultimoCbteFechaYmd?: string | null,
): string {
  if (normalizeArcaAmbiente(ambiente) !== 'produccion') {
    return resolveFechaCbteHomologacion(ultimoCbteFechaYmd);
  }
  const hoy = formatFechaCbteArgentina(new Date());
  const emision = formatFechaCbteArgentina(fechaEmision);
  return emision > hoy ? hoy : emision;
}

/** Homologación: evita 10016 por desfase UTC vs AR o fecha anterior al último comprobante. */
export function resolveFechaCbteHomologacion(ultimoCbteFechaYmd?: string | null): string {
  const ar = formatFechaCbteArgentina(new Date());
  const utc = formatFechaCbteUtc(new Date());
  let fecha = ar > utc ? ar : utc;
  const min = ultimoCbteFechaYmd?.replace(/\D/g, '').slice(0, 8);
  if (min && /^\d{8}$/.test(min) && min > fecha) {
    fecha = min;
  }
  return fecha;
}

/** Formato estándar PV-número para facturas/comprobantes (ej. 0001-00000045). */
export function formatNumeroComprobante(ptoVenta: number, cbteNro: number): string {
  return `${String(ptoVenta).padStart(4, '0')}-${String(cbteNro).padStart(8, '0')}`;
}
