import type { MicCrtActorDto, MicCrtExportDto } from './dto/mic-crt-export.dto';

export type MicCrtParty = MicCrtActorDto;

export type MicCrtStoredExport = MicCrtExportDto;

/** MIC campo 39 — declaración del porteador. */
export const MIC_CAMPO39_DECLARACION =
  'Declaramos que las informaciones presentadas en este Documento son expresión de verdad, que los datos referentes a las mercancías fueron transcriptos exactamente conforme a la declaración del remitente, los cuales son de su exclusiva responsabilidad, y que esta operación obedece a lo dispuesto en el Convenio sobre Transporte Internacional Terrestre de los países del Cono Sur.';

/** CRT campo 23 — recepción de mercaderías por el porteador. */
export const CRT_CAMPO23_DECLARACION =
  'Las mercaderías consignadas en esta Carta de Porte fueron recibidas por el porteador aparentemente en buen estado, bajo las condiciones generales que figuran al dorso.';

/** Códigos ISO / abreviados → nombre completo para el MIC (no mostrar "AR", "UY", etc.). */
const PAISES_ISO_MIC: Record<string, string> = {
  AR: 'Argentina',
  ARG: 'Argentina',
  BR: 'Brasil',
  BRA: 'Brasil',
  UY: 'Uruguay',
  URU: 'Uruguay',
  PY: 'Paraguay',
  PRY: 'Paraguay',
  CL: 'Chile',
  CHL: 'Chile',
  BO: 'Bolivia',
  BOL: 'Bolivia',
  PE: 'Perú',
  PER: 'Perú',
  CO: 'Colombia',
  COL: 'Colombia',
  EC: 'Ecuador',
  ECU: 'Ecuador',
  VE: 'Venezuela',
  VEN: 'Venezuela',
  MX: 'México',
  MEX: 'México',
  US: 'Estados Unidos',
  USA: 'Estados Unidos',
  ES: 'España',
  ESP: 'España',
  PT: 'Portugal',
  PRT: 'Portugal',
};

/** País legible en PDF MIC/CRT; si ya es nombre completo se deja igual. */
export function formatPaisMic(pais?: string | null): string {
  const raw = pais?.trim();
  if (!raw) return '';
  const mapped = PAISES_ISO_MIC[raw.toUpperCase()];
  if (mapped) return mapped;
  if (raw.length > 3 || /\s/.test(raw)) return raw;
  return raw;
}

function paisMicOGuion(pais?: string | null): string {
  return formatPaisMic(pais) || '—';
}

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
    pais: (() => {
      const raw = parsed.pais ?? args.pais ?? '';
      return formatPaisMic(raw) || raw;
    })(),
  };
}

export function formatPartyBlock(
  p: MicCrtParty | undefined,
  opts?: { includeIdFiscal?: boolean },
): string {
  if (!p?.razonSocial?.trim()) return '';
  const lines: string[] = [];
  const showCuit = opts?.includeIdFiscal !== false && p.idFiscal?.trim();
  const nameLine = showCuit
    ? `${p.razonSocial.trim()} CUIT: ${p.idFiscal!.trim()}`
    : p.razonSocial.trim();
  lines.push(nameLine);
  const calleNum = [p.calle?.trim(), p.numero?.trim()].filter(Boolean).join(' ');
  const paisFmt = formatPaisMic(p.pais);
  const loc = [calleNum, p.ciudad?.trim(), paisFmt].filter(Boolean).join(', ');
  if (loc) lines.push(loc);
  else if (calleNum) lines.push(calleNum);
  return lines.join('\n');
}

/** Bloque MIC campo 1 — porteador (sin CUIT; incluye permiso y seguro del vehículo). */
export function formatPorteadorMicBlock(args: {
  nombre: string;
  domicilio?: string | null;
  pais?: string | null;
  permisoInternacional?: string | null;
  vencimientoPermiso?: string | null;
  poliza?: string | null;
  vencimientoPoliza?: string | null;
}): string {
  const lines: string[] = [args.nombre.trim()];
  if (args.domicilio?.trim()) lines.push(args.domicilio.trim());
  const pais = formatPaisMic(args.pais);
  if (pais) lines.push(`País: ${pais}`);
  if (args.permisoInternacional?.trim()) {
    lines.push(`Permiso internacional N°: ${args.permisoInternacional.trim()}`);
  }
  if (args.vencimientoPermiso?.trim()) {
    lines.push(`Vencimiento permiso: ${args.vencimientoPermiso.trim()}`);
  }
  lines.push(`Seguro N°: ${args.poliza?.trim() || '—'}`);
  lines.push(`Vencimiento seguro: ${args.vencimientoPoliza?.trim() || '—'}`);
  return lines.join('\n');
}

/** CRT campo 5 — lugar y país de emisión con código aduanero. */
export function formatCrtCampo5EmisionBlock(args: {
  lugar?: string | null;
  pais?: string | null;
  codigoAduanero?: string | null;
}): string {
  const lines: string[] = [];
  if (args.lugar?.trim()) lines.push(args.lugar.trim());
  lines.push(`País: ${paisMicOGuion(args.pais)}`);
  lines.push(`Código aduanero: ${args.codigoAduanero?.trim() || '—'}`);
  return lines.join('\n');
}

/** CRT campos 7/8 — lugar, país y fecha o plazo. */
export function formatCrtLugarPaisFechaBlock(args: {
  lugar?: string | null;
  pais?: string | null;
  fecha?: string | null;
}): string {
  const lines: string[] = [];
  if (args.lugar?.trim()) lines.push(args.lugar.trim());
  lines.push(`País: ${paisMicOGuion(args.pais)}`);
  if (args.fecha?.trim()) lines.push(`Fecha: ${args.fecha.trim()}`);
  return lines.join('\n');
}

/** Bloque MIC campo 7 — aduana de partida. */
export function formatAduanaPartidaMicBlock(args: {
  ciudadLugar?: string | null;
  pais?: string | null;
  aduanaEspecifica?: string | null;
  codigoLugarOperativo?: string | null;
}): string {
  const lines: string[] = [];
  if (args.ciudadLugar?.trim()) lines.push(args.ciudadLugar.trim());
  lines.push(`País: ${paisMicOGuion(args.pais)}`);
  lines.push(`Aduana: ${args.aduanaEspecifica?.trim() || '—'}`);
  lines.push(`Código/lugar operativo: ${args.codigoLugarOperativo?.trim() || '—'}`);
  return lines.join('\n');
}

/** Bloque MIC campo 35 — consignatario (sin CUIT; domicilio y país en líneas separadas). */
export function formatConsignatarioMicBlock(p: MicCrtParty | undefined): string {
  if (!p?.razonSocial?.trim()) return '';
  const lines = [p.razonSocial.trim()];
  const calleNum = [p.calle?.trim(), p.numero?.trim()].filter(Boolean).join(' ');
  const domicilio = [calleNum, p.ciudad?.trim()].filter(Boolean).join(', ');
  lines.push(domicilio ? domicilio : 'Domicilio: —');
  lines.push(`País: ${paisMicOGuion(p.pais)}`);
  return lines.join('\n');
}

/** Bloque MIC campo 9 — propietario del camión (transportista). */
export function formatPropietarioCamionMicBlock(args: {
  nombre: string;
  domicilio?: string | null;
  pais?: string | null;
}): string {
  const lines = [args.nombre.trim()];
  lines.push(args.domicilio?.trim() ? args.domicilio.trim() : 'Domicilio: —');
  lines.push(`País: ${paisMicOGuion(args.pais)}`);
  return lines.join('\n');
}

/** Bloque MIC campo 8 — ciudad y país de destino final. */
export function formatAduanaDestinoMicBlock(args: {
  ciudadLugar?: string | null;
  pais?: string | null;
}): string {
  const lines: string[] = [];
  if (args.ciudadLugar?.trim()) lines.push(args.ciudadLugar.trim());
  lines.push(`País: ${paisMicOGuion(args.pais)}`);
  return lines.join('\n');
}

export function formatPorteadorCrtLine(nombre: string, idFiscal?: string | null): string {
  const cuit = idFiscal?.trim() ? ` CUIT: ${idFiscal.trim()}` : '';
  return `${nombre.trim()}${cuit}`;
}

/** Bloque MIC campo 26 — origen comercial y país / código aduanero. */
export function formatMicCampo26Block(args: {
  origenComercial?: string | null;
  pais?: string | null;
  codigoAduanero?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(
    `Origen comercial: ${args.origenComercial?.trim() ? args.origenComercial.trim() : '—'}`,
  );
  const pais = paisMicOGuion(args.pais);
  const codigo = args.codigoAduanero?.trim() || '—';
  lines.push(`País / Código aduanero: ${pais} / ${codigo}`);
  return lines.join('\n');
}

/** Bloque MIC campo 24 — aduana específica y código aduanero. */
export function formatMicCampo24Block(args: {
  aduanaEspecifica?: string | null;
  codigoAduanero?: string | null;
}): string {
  return [
    `Aduana: ${args.aduanaEspecifica?.trim() || '—'}`,
    `Código aduanero: ${args.codigoAduanero?.trim() || '—'}`,
  ].join('\n');
}

/** Bloque MIC campo 13 — identificación del remolque / unidad de transporte arrastre. */
export function formatRemolqueTransporteMicBlock(args: {
  patente?: string | null;
  marca?: string | null;
  modelo?: string | null;
  nroChasis?: string | null;
}): string {
  const lines: string[] = [];
  if (args.patente?.trim()) lines.push(args.patente.trim());
  const marcaModelo = [args.marca?.trim(), args.modelo?.trim()].filter(Boolean).join(' ');
  if (marcaModelo) lines.push(marcaModelo);
  if (args.nroChasis?.trim()) lines.push(args.nroChasis.trim());
  return lines.length > 0 ? lines.join('\n') : '—';
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

const CAMPO40_MARCADORES: { key: string; pattern: RegExp }[] = [
  { key: 'aduana', pattern: /ADUANA DE SALIDA\s*:/i },
  { key: 'plazoDia', pattern: /PLAZO DEL TRANSPORTE\s*:/i },
  { key: 'plazoHoras', pattern: /Plazo transporte\s*:/i },
  { key: 'plazoFrontera', pattern: /Plazo a frontera\s*:/i },
  { key: 'cond1', pattern: /CONDUCTOR 1\s*:/i },
  { key: 'cond2', pattern: /CONDUCTOR 2\s*:/i },
  { key: 'fechaArribo', pattern: /Fecha Prevista de Arribo\s*:/i },
];

type MicCampo40Secciones = {
  segmentosRuta: string[];
  aduana?: string;
  plazoDia?: string;
  plazoHoras?: string;
  plazoFrontera?: string;
  cond1?: string;
  cond2?: string;
  fechaArribo?: string;
};

function splitSegmentosRuta(route: string): string[] {
  if (!route.trim()) return [];
  return route
    .split(/\s*-\s*/)
    .map((s) => s.trim().replace(/\.\s*$/, ''))
    .filter(Boolean);
}

/** Parsea el texto libre de `dto.ruta` en secciones del MIC campo 40. */
export function parseMicCampo40Ruta(ruta?: string | null): MicCampo40Secciones {
  const raw = ruta?.trim();
  if (!raw) return { segmentosRuta: [] };

  const hits: { index: number; key: string; len: number }[] = [];
  for (const m of CAMPO40_MARCADORES) {
    const match = m.pattern.exec(raw);
    if (match) hits.push({ index: match.index, key: m.key, len: match[0].length });
  }
  hits.sort((a, b) => a.index - b.index);

  if (hits.length === 0) {
    return { segmentosRuta: splitSegmentosRuta(raw) };
  }

  const secciones: MicCampo40Secciones = { segmentosRuta: [] };
  const routeRaw = raw.slice(0, hits[0].index).trim().replace(/\.\s*$/, '');
  secciones.segmentosRuta = splitSegmentosRuta(routeRaw);

  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index + hits[i].len;
    const end = i + 1 < hits.length ? hits[i + 1].index : raw.length;
    const value = raw.slice(start, end).trim().replace(/\.\s*$/, '');
    (secciones as Record<string, string | string[] | undefined>)[hits[i].key] = value;
  }

  return secciones;
}

/**
 * Campo 40 — 3 columnas: ruta (tramos) | aduana y plazos | conductores.
 * Solo usa el texto de `dto.ruta`, sin datos duplicados del viaje.
 */
export function buildMicCampo40ColumnTexts(ruta?: string | null): [string, string, string] {
  const s = parseMicCampo40Ruta(ruta);

  const colRuta = s.segmentosRuta.join('\n') || '—';

  const colPlazos: string[] = [];
  if (s.aduana) colPlazos.push(`ADUANA DE SALIDA: ${s.aduana}`);
  if (s.plazoDia) colPlazos.push(`PLAZO DEL TRANSPORTE: ${s.plazoDia}`);
  if (s.plazoHoras) colPlazos.push(`Plazo transporte: ${s.plazoHoras}`);
  if (s.plazoFrontera) colPlazos.push(`Plazo a frontera: ${s.plazoFrontera}`);
  if (s.fechaArribo) colPlazos.push(`Fecha Prevista de Arribo: ${s.fechaArribo}`);

  const colConductores: string[] = [];
  if (s.cond1) colConductores.push(`CONDUCTOR 1: ${s.cond1}`);
  if (s.cond2) colConductores.push(`CONDUCTOR 2: ${s.cond2}`);

  return [colRuta, colPlazos.join('\n') || '—', colConductores.join('\n') || '—'];
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

export function formatMonedaPdf(moneda: string | undefined): string {
  return moneda === 'USD' ? 'DOL' : 'ARS';
}

export function formatMontoPdf(val: number | null | undefined, moneda?: string | null): string {
  if (val == null || Number.isNaN(val)) return '';
  const prefix = moneda === 'USD' ? 'USD ' : 'ARS ';
  return `${prefix}${val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const UNIDADES_LETRAS = [
  '',
  'UN',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
];
const DECENAS_LETRAS = [
  '',
  'DIEZ',
  'VEINTE',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];
const CENTENAS_LETRAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

function tresDigitosALetras(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const centStr = c > 0 ? CENTENAS_LETRAS[c] : '';
  if (resto === 0) return centStr;
  if (resto < 20) return [centStr, UNIDADES_LETRAS[resto]].filter(Boolean).join(' ');
  const d = Math.floor(resto / 10);
  const u = resto % 10;
  const decStr = u === 0 ? DECENAS_LETRAS[d] : `${DECENAS_LETRAS[d]} Y ${UNIDADES_LETRAS[u]}`;
  return [centStr, decStr].filter(Boolean).join(' ');
}

function enteroALetras(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones > 0) {
    partes.push(`${tresDigitosALetras(millones)} ${millones === 1 ? 'MILLÓN' : 'MILLONES'}`);
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'MIL' : `${tresDigitosALetras(miles)} MIL`);
  }
  if (resto > 0) partes.push(tresDigitosALetras(resto));
  return partes.join(' ');
}

function centavosALetras(c: number): string {
  if (c === 0) return 'CERO CENTAVOS';
  if (c === 1) return 'UN CENTAVO';
  return `${tresDigitosALetras(c)} CENTAVOS`;
}

/** CRT campo 16 — valor FOT en palabras (sin dígitos). */
export function montoEnLetras(val: number, moneda: string): string {
  if (val == null || Number.isNaN(val) || val < 0) return '';
  const entero = Math.floor(val);
  const centavos = Math.round((val - entero) * 100);
  const monedaLabel = moneda === 'USD' ? 'DÓLARES ESTADOUNIDENSES' : 'PESOS ARGENTINOS';
  return `SON ${monedaLabel} ${enteroALetras(entero)} CON ${centavosALetras(centavos)}`;
}

export function descripcionMercanciasPdf(dto: MicCrtExportDto): string {
  const lines: string[] = [];
  if (dto.ncm?.trim()) lines.push(`NCM: ${dto.ncm.trim()}`);
  if (dto.descripcionMercaderias?.trim()) lines.push(dto.descripcionMercaderias.trim());
  return lines.join('\n');
}

/** CRT campo 11 — cantidad/clase de bultos + NCM y descripción de mercancías. */
export function formatCrtCampo11Block(dto: MicCrtExportDto): string {
  const lines: string[] = [];
  if (dto.bultos > 0 || dto.tipoBultos?.trim()) {
    lines.push(
      `Cantidad: ${dto.bultos > 0 ? dto.bultos : '—'} · Clase: ${dto.tipoBultos?.trim() || '—'}`,
    );
  }
  const desc = descripcionMercanciasPdf(dto);
  if (desc) lines.push(desc);
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
