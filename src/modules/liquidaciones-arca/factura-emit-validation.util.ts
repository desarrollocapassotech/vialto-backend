import { BadRequestException } from '@nestjs/common';

function blank(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === '';
}

export type FacturaEmitEmisor = {
  cuitEmisor?: string | null;
  razonSocial?: string | null;
  domicilioEmisor?: string | null;
  ingBrutos?: string | null;
  inicActEmisor?: string | null;
};

export type FacturaEmitCliente = {
  nombre?: string | null;
  direccion?: string | null;
  idFiscal?: string | null;
  condicionIva?: number | null;
};

/** Lista legible de datos faltantes para emitir Factura A/B con PDF completo. */
export function collectFacturaEmitMissingFields(args: {
  emisor: FacturaEmitEmisor | null | undefined;
  cliente: FacturaEmitCliente | null | undefined;
}): string[] {
  const missing: string[] = [];
  const e = args.emisor;
  if (!e || blank(e.cuitEmisor)) missing.push('Emisor: CUIT');
  if (!e || blank(e.razonSocial)) missing.push('Emisor: razón social');
  if (!e || blank(e.domicilioEmisor)) missing.push('Emisor: domicilio');
  if (!e || blank(e.ingBrutos)) missing.push('Emisor: Ingresos Brutos');
  if (!e || blank(e.inicActEmisor)) missing.push('Emisor: inicio de actividad');

  const c = args.cliente;
  if (!c || blank(c.nombre)) missing.push('Cliente: nombre');
  if (!c || blank(c.direccion)) missing.push('Cliente: domicilio');
  if (!c || blank(c.idFiscal)) missing.push('Cliente: CUIT');
  if (c?.condicionIva == null || !Number.isFinite(c.condicionIva)) {
    missing.push('Cliente: condición de IVA');
  }

  return missing;
}

/** Fail-fast antes de pedir CAE / generar comprobante definitivo. */
export function assertFacturaEmitDatosCompletos(args: {
  emisor: FacturaEmitEmisor | null | undefined;
  cliente: FacturaEmitCliente | null | undefined;
}): void {
  const missing = collectFacturaEmitMissingFields(args);
  if (missing.length === 0) return;
  throw new BadRequestException(
    `No se puede emitir el comprobante. Faltan datos: ${missing.join('; ')}.`,
  );
}
