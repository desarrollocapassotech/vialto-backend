import type { MicCrtActorDto, MicCrtExportDto } from './dto/mic-crt-export.dto';

export type MicCrtParty = MicCrtActorDto;

export type MicCrtStoredExport = MicCrtExportDto;

/** Parte de domicilio parseada desde un string libre. */
export function parseDireccionLibre(direccion?: string | null): Partial<MicCrtParty> {
  const raw = direccion?.trim();
  if (!raw) return {};
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      calle: parts[0],
      ciudad: parts[parts.length - 2],
      pais: parts[parts.length - 1],
    };
  }
  if (parts.length === 2) {
    return { calle: parts[0], ciudad: parts[1] };
  }
  return { calle: raw };
}

export function partyFromEntity(args: {
  nombre: string;
  idFiscal?: string | null;
  direccion?: string | null;
  domicilio?: string | null;
  pais?: string | null;
}): MicCrtParty {
  const parsed = parseDireccionLibre(args.direccion ?? args.domicilio);
  return {
    razonSocial: args.nombre,
    idFiscal: args.idFiscal ?? '',
    calle: parsed.calle ?? '',
    numero: parsed.numero ?? '',
    ciudad: parsed.ciudad ?? '',
    pais: parsed.pais ?? args.pais ?? '',
  };
}

export function formatPartyBlock(p: MicCrtParty | undefined): string {
  if (!p?.razonSocial?.trim()) return '';
  const lines: string[] = [];
  const nameLine = p.idFiscal?.trim()
    ? `${p.razonSocial.trim()} CUIT: ${p.idFiscal.trim()}`
    : p.razonSocial.trim();
  lines.push(nameLine);
  const calleNum = [p.calle?.trim(), p.numero?.trim()].filter(Boolean).join(' ');
  const loc = [calleNum, p.ciudad?.trim(), p.pais?.trim()].filter(Boolean).join(', ');
  if (loc) lines.push(loc);
  else if (calleNum) lines.push(calleNum);
  return lines.join('\n');
}

export function formatPorteadorMicBlock(args: {
  nombre: string;
  idFiscal?: string | null;
  domicilio?: string | null;
  pais?: string | null;
}): string {
  const lines: string[] = [args.nombre.trim()];
  if (args.idFiscal?.trim()) lines.push(`CUIT: ${args.idFiscal.trim()}`);
  if (args.domicilio?.trim()) lines.push(args.domicilio.trim());
  if (args.pais?.trim()) lines.push(args.pais.trim());
  return lines.join('\n');
}

export function formatPorteadorCrtLine(nombre: string, idFiscal?: string | null): string {
  const cuit = idFiscal?.trim() ? ` CUIT: ${idFiscal.trim()}` : '';
  return `${nombre.trim()}${cuit}`;
}

export function formatMarcaNumeroPdf(camion: {
  marca: string | null;
  modelo: string | null;
  nroChasis: string | null;
} | null): string {
  if (!camion) return '';
  const linea1 = [camion.marca, camion.modelo].filter(Boolean).join(' ').trim();
  const linea2 = camion.nroChasis?.trim() ?? '';
  return [linea1, linea2].filter(Boolean).join('\n');
}

export function formatConductorMicPdf(chofer: {
  nombre: string;
  dni: string | null;
  licencia?: string | null;
}): string {
  const doc =
    chofer.dni?.trim() != null
      ? `DOC: ${chofer.dni.trim().toUpperCase().startsWith('CI') ? chofer.dni.trim() : `CI ${chofer.dni.trim()}`}`
      : 'DOC:';
  const lic = chofer.licencia?.trim() ? `  LIC: ${chofer.licencia.trim()}` : '';
  return `CONDUCTOR 1: ${chofer.nombre.trim()} ${doc}${lic}`.trim();
}

export function formatMicCampo40Pdf(args: {
  ruta?: string | null;
  fechaArribo?: Date | string | null;
  chofer?: { nombre: string; dni: string | null; licencia?: string | null } | null;
  fmt: (d: Date | string | null | undefined) => string;
}): string {
  const parts: string[] = [];
  if (args.ruta?.trim()) parts.push(args.ruta.trim());
  if (args.fechaArribo) parts.push(`Fecha Prevista de Arribo: ${args.fmt(args.fechaArribo)}`);
  if (args.chofer) parts.push(formatConductorMicPdf(args.chofer));
  return parts.join('\n');
}

export function formatMonedaPdf(moneda: string | undefined): string {
  return moneda === 'USD' ? 'DOL' : 'ARS';
}

export function formatMontoPdf(val: number | null | undefined, moneda?: string | null): string {
  if (val == null || Number.isNaN(val)) return '';
  const prefix = moneda === 'USD' ? 'USD ' : 'ARS ';
  return `${prefix}${val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function montoEnLetras(val: number, moneda: string): string {
  const label = moneda === 'USD' ? 'DÓLARES ESTADOUNIDENSES' : 'PESOS ARGENTINOS';
  return `SON ${label} ${val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function descripcionMercanciasPdf(dto: MicCrtExportDto): string {
  const lines: string[] = [];
  if (dto.ncm?.trim()) lines.push(`NCM: ${dto.ncm.trim()}`);
  if (dto.descripcionMercaderias?.trim()) lines.push(dto.descripcionMercaderias.trim());
  return lines.join('\n');
}

export function todayIsoDateLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function readStoredMicCrtExport(documentoAduanero: unknown): MicCrtStoredExport | null {
  if (!documentoAduanero || typeof documentoAduanero !== 'object') return null;
  const raw = documentoAduanero as Record<string, unknown>;
  if (typeof raw.micNumero === 'string' && typeof raw.crtNumero === 'string') {
    return raw as unknown as MicCrtStoredExport;
  }
  const nested = raw.micCrtExport;
  if (nested && typeof nested === 'object') return nested as unknown as MicCrtStoredExport;
  return null;
}
