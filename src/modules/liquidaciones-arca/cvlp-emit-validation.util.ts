import { BadRequestException } from '@nestjs/common';

function blank(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === '';
}

export type CvlpEmitEmisor = {
  cuitEmisor?: string | null;
  domicilioEmisor?: string | null;
  ingBrutos?: string | null;
  inicActEmisor?: string | null;
};

export type CvlpEmitTransportista = {
  domicilio?: string | null;
  idFiscal?: string | null;
  condicionIva?: number | null;
};

export type CvlpEmitCliente = {
  nombre?: string | null;
  direccion?: string | null;
  idFiscal?: string | null;
};

/**
 * Lista legible de datos faltantes para emitir CVLP / PDF completo.
 * Vacío = listo para emitir.
 */
export function collectCvlpEmitMissingFields(args: {
  emisor: CvlpEmitEmisor | null | undefined;
  transportista: CvlpEmitTransportista | null | undefined;
  cliente: CvlpEmitCliente | null | undefined;
}): string[] {
  const missing: string[] = [];
  const e = args.emisor;
  if (!e || blank(e.cuitEmisor)) missing.push('Emisor: CUIT');
  if (!e || blank(e.domicilioEmisor)) missing.push('Emisor: domicilio');
  if (!e || blank(e.ingBrutos)) missing.push('Emisor: Ingresos Brutos');
  if (!e || blank(e.inicActEmisor)) missing.push('Emisor: inicio de actividad');

  const t = args.transportista;
  if (!t || blank(t.domicilio)) missing.push('Transportista: domicilio');
  if (!t || blank(t.idFiscal)) missing.push('Transportista: CUIT');
  if (t?.condicionIva == null || !Number.isFinite(t.condicionIva)) {
    missing.push('Transportista: condición de IVA');
  }

  const c = args.cliente;
  if (!c || blank(c.nombre)) missing.push('Cliente: nombre');
  if (!c || blank(c.direccion)) missing.push('Cliente: domicilio');
  if (!c || blank(c.idFiscal)) missing.push('Cliente: CUIT');

  return missing;
}

/** Fail-fast antes de pedir CAE / generar comprobante definitivo. */
export function assertCvlpEmitDatosCompletos(args: {
  emisor: CvlpEmitEmisor | null | undefined;
  transportista: CvlpEmitTransportista | null | undefined;
  cliente: CvlpEmitCliente | null | undefined;
}): void {
  const missing = collectCvlpEmitMissingFields(args);
  if (missing.length === 0) return;
  throw new BadRequestException(
    `No se puede emitir el comprobante. Faltan datos: ${missing.join('; ')}.`,
  );
}
