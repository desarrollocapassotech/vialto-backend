export type ArcaAmbiente = 'homologacion' | 'produccion';

export interface ArcaTokenResponse {
  token: string;
  sign: string;
  expiration: string; // ISO 8601
}

export interface ArcaLastVoucherResponse {
  CbteNro: number;
}

export interface AlicIva {
  Id: number;    // 3=0%, 4=10.5%, 5=21%, 6=27%
  BaseImp: number;
  Importe: number;
}

export interface ArcaAutorizarRequest {
  ambiente: ArcaAmbiente;
  cuit: string;
  ptoVenta: number;
  cbteTipo: number;   // 1=Factura A, 6=Factura B, 60=CVLP A, 61=CVLP B
  cbteNro: number;
  fechaCbte: string;  // yyyymmdd
  concepto: number;   // 1=Productos, 2=Servicios, 3=Ambos
  docTipo: number;    // 80=CUIT, 99=Consumidor Final
  docNro: number;     // CUIT del receptor o 0
  condicionIvaReceptorId: number;
  impNeto: number;
  impIva: number;
  impTotal: number;
  monId?: string;     // default 'PES'
  monCotiz?: number;  // default 1
  alicuotasIva?: AlicIva[];
}

export interface ArcaAutorizarResponse {
  CAE: string;
  CAEFchVto: string; // yyyymmdd
}

/**
 * Representa una línea de detalle dentro del comprobante interno de la aplicación.
 * Este objeto se utiliza exclusivamente para presentación y auditoría,
 * ya que WSFEv1 no soporta detalle de líneas.
 */
export interface ArcaComprobanteItem {
  descripcion: string;
  importeBase: number;
  ivaPct: number;
  importeIva: number;
  subtotal: number;
}

/**
 * Modelo de dominio interno que representa el comprobante CVLP íntegro.
 * Totalmente desacoplado de las estructuras del SDK de AFIP.
 */
export interface ArcaComprobanteCvlp {
  cuit: string;
  ptoVenta: number;
  cbteTipo: number;
  cbteNro: number;
  fechaCbte: string;
  concepto: number;
  docTipo: number;
  docNro: number;
  condicionIvaReceptorId: number;
  
  impNeto: number;
  impIva: number;
  impTotal: number;
  alicuotasIva: AlicIva[];
  
  items: ArcaComprobanteItem[];
}

export interface ArcaErrorTyped {
  code: string;
  message: string;
}

// Códigos de error de AFIP SDK / ARCA que el sistema reconoce
export const ARCA_ERROR_CODES = {
  CUIT_INVALIDO: 'CUIT_INVALIDO',
  CERT_VENCIDO: 'CERT_VENCIDO',
  FUERA_DE_RANGO: 'FUERA_DE_RANGO',
  CONECTIVIDAD: 'CONECTIVIDAD',
  CONFIG_FALTANTE: 'CONFIG_FALTANTE',
  COMPROBANTE_DUPLICADO: 'COMPROBANTE_DUPLICADO',
  GENERICO: 'GENERICO',
} as const;

export type ArcaErrorCode = (typeof ARCA_ERROR_CODES)[keyof typeof ARCA_ERROR_CODES];

export class ArcaException extends Error {
  constructor(
    public readonly code: ArcaErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'ArcaException';
  }
}
