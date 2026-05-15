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
  token: string;
  sign: string;
  ptoVenta: number;
  cbteTipo: number;   // 1=Factura A, 6=Factura B, 60=CVLP
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
