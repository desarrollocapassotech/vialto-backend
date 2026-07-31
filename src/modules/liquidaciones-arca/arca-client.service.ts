import { Injectable, Logger } from '@nestjs/common';
import Afip = require('@afipsdk/afip.js');
import { PrismaService } from '../../shared/prisma/prisma.service';
import { decryptField } from '../../shared/util/arca-crypto';
import {
  ArcaAmbiente,
  ArcaAutorizarRequest,
  ArcaAutorizarResponse,
  ArcaErrorCode,
  ArcaException,
  ArcaLastVoucherResponse,
  ARCA_ERROR_CODES,
} from './types/arca.types';
import {
  enrichAfipRejectionMessage,
  extractAfipRejectionMessage,
  extractAfipSdkHttpError,
  formatAfipRejectionForUser,
} from './arca-error.util';
import { normalizeArcaAmbiente } from './arca.util';
import { round2 } from './arca-iva.util';

/** AFIP SDK usa "dev"/"prod", no "homologacion"/"produccion" */
function toSdkEnv(ambiente: ArcaAmbiente): 'dev' | 'prod' {
  return normalizeArcaAmbiente(ambiente) === 'produccion' ? 'prod' : 'dev';
}

function isProductionAmbiente(ambiente: ArcaAmbiente): boolean {
  return normalizeArcaAmbiente(ambiente) === 'produccion';
}

/** Normaliza CUIT: elimina guiones y espacios → "30-71234567-8" → "30712345678" */
function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s]/g, '');
}

/**
 * Normaliza un certificado/clave PEM antes de enviarlo al SDK de AFIP.
 * Corrige el caso típico de credenciales pegadas o almacenadas con saltos de
 * línea escapados ("\n" literales) o con CRLF, que hacen que afip.js falle con
 * "Invalid PEM formatted message".
 */
function normalizePem(pem: string): string {
  if (!pem) return pem;
  return pem
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim() + '\n';
}

/**
 * Abstracción sobre el SDK oficial de AFIP (afipsdk.com).
 * Si en el futuro se cambia de proveedor, solo hay que reescribir este servicio.
 * Todas las operaciones WSFEv1 pasan por aquí:
 *  - Autenticación WSAA delegada al SDK
 *  - Generación, firma y obtención del token/sign delegada al SDK
 *  - Último número autorizado por punto de venta + tipo de comprobante
 *  - Autorización de comprobante (FECAESolicitar) → CAE
 */
@Injectable()
export class ArcaClientService {
  private readonly logger = new Logger(ArcaClientService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Público: operaciones de negocio ────────────────────────────────────────

  async getUltimoComprobante(
    apiKey: string,
    cuit: string,
    ambiente: ArcaAmbiente,
    ptoVenta: number,
    cbteTipo: number,
    tenantId: string,
    liquidacionId?: string,
    facturaId?: string,
    certPem?: string | null,
    keyPem?: string | null,
  ): Promise<ArcaLastVoucherResponse> {
    const cuitNorm = normalizeCuit(cuit);
    const ambienteNorm = normalizeArcaAmbiente(ambiente);
    const { token, sign, afip } = await this.getAfipClientAndToken(
      apiKey,
      cuitNorm,
      ambienteNorm,
      certPem,
      keyPem,
    );

    const params = {
      Auth: { Token: token, Sign: sign, Cuit: cuitNorm },
      PtoVta: ptoVenta,
      CbteTipo: cbteTipo,
    };

    const response = await this.callAfipSdk(
      afip,
      'FECompUltimoAutorizado',
      params,
      cuitNorm,
      tenantId,
      liquidacionId,
      facturaId,
      ambienteNorm,
    );

    const result = (response?.FECompUltimoAutorizadoResult ?? response) as Record<string, unknown>;
    return { CbteNro: (result?.CbteNro as number | undefined) ?? 0 };
  }

  async autorizarComprobante(
    apiKey: string,
    req: ArcaAutorizarRequest,
    tenantId: string,
    liquidacionId?: string,
    facturaId?: string,
    certPem?: string | null,
    keyPem?: string | null,
    auditMetadata?: Record<string, unknown>,
  ): Promise<ArcaAutorizarResponse> {
    const cuitNorm = normalizeCuit(req.cuit);
    const ambienteNorm = normalizeArcaAmbiente(req.ambiente);
    const { token, sign, afip } = await this.getAfipClientAndToken(
      apiKey,
      cuitNorm,
      ambienteNorm,
      certPem,
      keyPem,
    );

    const params = {
      Auth: { Token: token, Sign: sign, Cuit: cuitNorm },
      FeCAEReq: {
        FeCabReq: {
          CantReg: 1,
          PtoVta: req.ptoVenta,
          CbteTipo: req.cbteTipo,
        },
        FeDetReq: {
          FECAEDetRequest: {
            Concepto: req.concepto,
            DocTipo: req.docTipo,
            DocNro: req.docNro,
            CbteDesde: req.cbteNro,
            CbteHasta: req.cbteNro,
            CbteFch: Number(req.fechaCbte),
            ImpTotal: round2(req.impTotal),
            ImpTotConc: 0,
            ImpNeto: round2(req.impNeto),
            ImpOpEx: 0,
            ImpIVA: round2(req.impIva),
            ImpTrib: 0,
            MonId: req.monId ?? 'PES',
            MonCotiz: req.monCotiz ?? 1,
            CondicionIVAReceptorId: req.condicionIvaReceptorId,
            ...(() => {
              const alic = (req.alicuotasIva ?? [])
                .filter((a) => a.BaseImp > 0)
                .map((a) => ({
                  Id: a.Id,
                  BaseImp: round2(a.BaseImp),
                  Importe: round2(a.Importe),
                }));
              return alic.length ? { Iva: { AlicIva: alic } } : {};
            })(),
          },
        },
      },
    };

    const response = await this.callAfipSdk(
      afip,
      'FECAESolicitar',
      params,
      cuitNorm,
      tenantId,
      liquidacionId,
      facturaId,
      ambienteNorm,
      auditMetadata,
    );

    // AFIP SDK devuelve la respuesta anidada bajo FECAESolicitarResult
    const solResult = (response?.FECAESolicitarResult ?? response) as Record<string, unknown>;
    const detResp = (solResult?.FeDetResp as Record<string, unknown>);
    const detArr = detResp?.FECAEDetResponse as Record<string, unknown>[] | undefined;
    const det = Array.isArray(detArr) ? detArr[0] : (detArr as Record<string, unknown> | undefined);

    const errores = (solResult?.Errors as Record<string, unknown>)?.Err;
    if (errores) {
      const errArr = Array.isArray(errores) ? errores : [errores];
      const msgs = (errArr as Record<string, unknown>[])
        .map((e) => String(e.Msg ?? e.Message ?? '').trim())
        .filter(Boolean);
      const userMsg = msgs.length
        ? enrichAfipRejectionMessage(`Rechazado por AFIP: ${msgs.join(' ')}`)
        : formatAfipRejectionForUser(response);
      this.logger.error(`FECAESolicitar AFIP Errors: ${msgs.join(' | ') || userMsg}`);
      throw new ArcaException(ARCA_ERROR_CODES.GENERICO, userMsg, undefined, response);
    }

    const cae = det?.CAE as string | undefined;
    const caeFchVto = det?.CAEFchVto as string | undefined;

    if (!cae) {
      const userMsg = formatAfipRejectionForUser(response);
      const detail = extractAfipRejectionMessage(response);
      this.logger.error(
        `FECAESolicitar sin CAE${detail ? `: ${detail}` : ''} | ${JSON.stringify(response)}`,
      );
      throw new ArcaException(ARCA_ERROR_CODES.GENERICO, userMsg, undefined, response);
    }

    return {
      CAE: String(cae),
      CAEFchVto: String(caeFchVto),
    };
  }

  // ── Privado: token y request base ──────────────────────────────────────────

  private async getAfipClientAndToken(
    apiKey: string,
    cuitNorm: string,
    ambiente: ArcaAmbiente,
    certPem?: string | null,
    keyPem?: string | null,
  ): Promise<{ token: string; sign: string; afip: Afip }> {
    const certKey: Record<string, string> = {};
    const ambienteNorm = normalizeArcaAmbiente(ambiente);
    const production = isProductionAmbiente(ambienteNorm);

    try {
      if (certPem) {
        const dec = decryptField(certPem);
        if (dec) certKey.cert = normalizePem(dec);
      }
      if (keyPem) {
        const dec = decryptField(keyPem);
        if (dec) certKey.key = normalizePem(dec);
      }
    } catch (decErr) {
      this.logger.error(`Error de descifrado de certificados para CUIT ${cuitNorm}: ${decErr.message}`);
      throw new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        'Fallo de credenciales ARCA: Los certificados o llaves configurados no se pudieron descifrar correctamente. Por favor, vuelva a cargarlos en la configuración.',
        undefined,
        decErr
      );
    }

    if (!certKey.cert?.trim() || !certKey.key?.trim()) {
      throw new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        'Falta el certificado digital o la clave privada para conectar con AFIP. Cargalos en Superadmin → ARCA / AFIP (homologación) y guardá.',
      );
    }

    try {
      // `production` + ElectronicBilling (URLs prod/homo) — NO usar WebService('wsfe')
      // genérico: deja url/wsdl undefined y el proxy de AFIP SDK cae en homologación.
      const afip = new Afip({
        CUIT: cuitNorm,
        access_token: apiKey,
        production,
        ...certKey,
      });

      const ta = await afip.ElectronicBilling.getTokenAuthorization();

      this.logger.log(
        `Token/Sign AFIP SDK OK CUIT ${cuitNorm} ambiente=${ambienteNorm} sdkEnv=${production ? 'prod' : 'dev'}`,
      );
      return { token: ta.token, sign: ta.sign, afip };
    } catch (err) {
      const errMsg = String((err as { message?: string })?.message ?? err);
      const httpStatus =
        (err as { status?: number })?.status ||
        (err as { statusCode?: number })?.statusCode;
      const sdkDetail =
        extractAfipSdkHttpError(err) ??
        (() => {
          const respData = (err as { data?: unknown; response?: { data?: unknown } })?.data
            ?? (err as { response?: { data?: unknown } })?.response?.data;
          if (!respData) return null;
          return typeof respData === 'string'
            ? respData
            : JSON.stringify(respData);
        })();
      this.logger.error(
        `Error obteniendo token AFIP SDK: ${errMsg}${sdkDetail ? ` | AfipSDK: ${sdkDetail}` : ''}`,
      );
      throw this.mapTokenAuthError(err, httpStatus, ambienteNorm, sdkDetail);
    }
  }

  private async callAfipSdk(
    afip: Afip,
    method: string,
    params: Record<string, unknown>,
    cuit: string,
    tenantId: string,
    liquidacionId?: string,
    facturaId?: string,
    ambiente?: ArcaAmbiente,
    auditMetadata?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ambienteNorm = normalizeArcaAmbiente(ambiente);
    const sdkEnv = toSdkEnv(ambienteNorm);
    const requestBody = { environment: sdkEnv, method, wsid: 'wsfe', params };
    const start = Date.now();
    let httpStatus: number | undefined;
    let responseBody: unknown;
    let exitoso = false;
    let errorMsg: string | undefined;

    try {
      // ElectronicBilling fija URL prod (servicios1) vs homo (wswhomo) según `production`.
      const body = await afip.ElectronicBilling.executeRequest(method, params);
      responseBody = body;
      exitoso = true;
      return body;
    } catch (err) {
      errorMsg = String(err?.message ?? err);
      httpStatus = (err as any)?.status || (err as any)?.statusCode;
      throw this.mapError(err, httpStatus);
    } finally {
      // Log de auditoría — nunca se registra la apiKey
      const safeRequest: Record<string, unknown> = { ...requestBody, cuit: normalizeCuit(cuit) };
      if ((safeRequest.params as Record<string, unknown>)?.Auth) {
        (safeRequest.params as Record<string, unknown>).Auth = '***';
      }
      if (auditMetadata) {
        safeRequest.auditMetadata = auditMetadata;
      }

      await (this.prisma as any).arcaLog.create({
        data: {
          tenantId,
          liquidacionId: liquidacionId ?? null,
          facturaId: facturaId ?? null,
          method,
          ambiente: ambienteNorm,
          cuit,
          requestBody: safeRequest as object,
          responseBody: responseBody ? (responseBody as object) : undefined,
          httpStatus: httpStatus ?? null,
          durationMs: Date.now() - start,
          exitoso,
          error: errorMsg ?? null,
        },
      });
    }
  }

  /** Error al obtener token WSAA (POST v1/afip/auth en AfipSDK). */
  private mapTokenAuthError(
    raw: unknown,
    httpStatus?: number,
    ambiente?: ArcaAmbiente,
    sdkDetail?: string | null,
  ): ArcaException {
    const detail = sdkDetail?.trim();
    const ambLabel = ambiente === 'produccion' ? 'producción' : 'homologación';

    if (httpStatus === 401 || httpStatus === 403) {
      return new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        `AfipSDK rechazó la API key (HTTP ${httpStatus}). Verificá AFIP_SDK_API_KEY en el servidor.${detail ? ` ${detail}` : ''}`,
        httpStatus,
        raw,
      );
    }

    const lower = (detail ?? '').toLowerCase();
    if (lower.includes('cert') || lower.includes('key') || lower.includes('tax_id')) {
      return new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        `No se pudo autenticar con AFIP (${ambLabel}). Revisá CUIT, certificado y clave privada de homologación.${detail ? ` AfipSDK: ${detail}` : ''}`,
        httpStatus,
        raw,
      );
    }

    return new ArcaException(
      ARCA_ERROR_CODES.GENERICO,
      `No se pudo obtener el token de AFIP (${ambLabel}). Verificá AFIP_SDK_API_KEY, CUIT ${ambiente === 'produccion' ? 'y certificado de producción' : 'y certificado de homologación'}.${detail ? ` AfipSDK: ${detail}` : ''}`,
      httpStatus,
      raw,
    );
  }

  private mapError(raw: any, httpStatus?: number): ArcaException {
    let errCode: number | undefined;
    let rawStr = '';
    const sdkDetail = extractAfipSdkHttpError(raw);

    if (typeof raw === 'object' && raw !== null) {
      errCode = raw.code; // El SDK usa la propiedad 'code' en minúscula (instancia de AfipWebServiceError)
      rawStr = sdkDetail || raw.message || String(raw);
    } else {
      rawStr = String(raw);
    }

    if (errCode) {
      const codeNum = Number(errCode);
      switch (codeNum) {
        // Códigos oficiales de AFIP / ARCA (Manual de desarrollador WSFEv1):
        // 600: Error de validación de firma o token (WSAA/mismatch de CUIT).
        case 600:
          return new ArcaException(
            ARCA_ERROR_CODES.CUIT_INVALIDO,
            'Error de validación de token (Error 600): El CUIT informado no corresponde con el certificado o el token es inválido.',
            httpStatus,
            raw,
          );
        // 10007: Punto de venta inválido.
        // 10008: Número de comprobante desde/hasta inválido.
        // 10016: El número o fecha del comprobante no corresponde al próximo a autorizar.
        case 10007:
        case 10008:
        case 10016:
          return new ArcaException(
            ARCA_ERROR_CODES.FUERA_DE_RANGO,
            `El número o fecha de comprobante no corresponde al rango o al próximo a autorizar (Error ${codeNum}).`,
            httpStatus,
            raw,
          );
        // 10015: Comprobante ya registrado/autorizado anteriormente (duplicado).
        case 10015:
          return new ArcaException(
            ARCA_ERROR_CODES.COMPROBANTE_DUPLICADO,
            'El comprobante ya fue autorizado anteriormente en AFIP / ARCA (Error 10015).',
            httpStatus,
            raw,
          );
        // 11002: Punto de venta no habilitado para WSFE (Factura electrónica).
        case 11002:
          return new ArcaException(
            ARCA_ERROR_CODES.FUERA_DE_RANGO,
            enrichAfipRejectionMessage(
              'Rechazado por AFIP: (11002) El punto de venta no está habilitado para Factura electrónica (WSFE).',
            ),
            httpStatus,
            raw,
          );
      }
    }

    const lower = rawStr.toLowerCase();
    if (lower.includes('cuit') && lower.includes('inváli')) {
      return new ArcaException(ARCA_ERROR_CODES.CUIT_INVALIDO, 'El CUIT informado es inválido.', httpStatus, raw);
    }
    if (lower.includes('certificado') && (lower.includes('vencido') || lower.includes('expirado'))) {
      return new ArcaException(ARCA_ERROR_CODES.CERT_VENCIDO, 'El certificado de ARCA está vencido. Renovarlo en el portal de AFIP SDK.', httpStatus, raw);
    }
    // Certificado o clave privada faltante (error de configuración del servidor)
    if (
      (lower.includes('cert') || lower.includes('certificado')) && lower.includes('obligatorio') ||
      lower.includes('key') && lower.includes('obligatorio')
    ) {
      return new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        'Falta el certificado digital o la clave privada para conectar con AFIP. Contactá al administrador del sistema.',
        httpStatus,
        raw,
      );
    }
    if (lower.includes('fuera de rango') || lower.includes('número inválido')) {
      return new ArcaException(ARCA_ERROR_CODES.FUERA_DE_RANGO, 'El número de comprobante está fuera de rango.', httpStatus, raw);
    }
    if (lower.includes('duplicado') || lower.includes('already exists')) {
      return new ArcaException(ARCA_ERROR_CODES.COMPROBANTE_DUPLICADO, 'El comprobante ya fue autorizado anteriormente.', httpStatus, raw);
    }
    if (httpStatus === 0 || lower.includes('timeout') || lower.includes('econnrefused') || lower.includes('network')) {
      return new ArcaException(ARCA_ERROR_CODES.CONECTIVIDAD, 'AFIP SDK no respondió. El comprobante quedó en estado pendiente_cae para reintentar.', httpStatus, raw);
    }
    if (httpStatus === 400 || lower.match(/^http 4\d\d$/)) {
      const detail =
        rawStr &&
        !/^http 4\d\d$/i.test(rawStr.trim()) &&
        rawStr.trim().length > 0
          ? ` Detalle técnico: ${rawStr.trim()}`
          : '';
      return new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        `AFIP / ARCA rechazó la solicitud. Verificá que el CUIT, el punto de venta y el certificado estén correctamente configurados.${detail}`,
        httpStatus,
        raw,
      );
    }
    return new ArcaException(ARCA_ERROR_CODES.GENERICO, rawStr, httpStatus, raw);
  }
}
