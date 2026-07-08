import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ArcaAmbiente,
  ArcaAutorizarRequest,
  ArcaAutorizarResponse,
  ArcaErrorCode,
  ArcaException,
  ArcaLastVoucherResponse,
  ArcaTokenResponse,
  ARCA_ERROR_CODES,
} from './types/arca.types';
import { extractAfipRejectionMessage, formatAfipRejectionForUser } from './arca-error.util';
import { round2 } from './arca-iva.util';

const AFIP_SDK_BASE = 'https://app.afipsdk.com/api/v1';

/** AFIP SDK usa "dev"/"prod", no "homologacion"/"produccion" */
function toSdkEnv(ambiente: ArcaAmbiente): 'dev' | 'prod' {
  return ambiente === 'produccion' ? 'prod' : 'dev';
}

/** Normaliza CUIT: elimina guiones y espacios → "30-71234567-8" → "30712345678" */
function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s]/g, '');
}

interface CachedToken {
  token: string;
  sign: string;
  expiresAt: Date;
}

/**
 * Abstracción sobre la API REST de AFIP SDK (afipsdk.com).
 * Si en el futuro se cambia de proveedor, solo hay que reescribir este servicio.
 * Todas las operaciones WSFEv1 pasan por aquí:
 *  - Obtención y caché del Access Ticket (TA)
 *  - Último número autorizado por punto de venta + tipo de comprobante
 *  - Autorización de comprobante (FECAESolicitar) → CAE
 */
@Injectable()
export class ArcaClientService {
  private readonly logger = new Logger(ArcaClientService.name);

  // Caché en memoria: "<cuit>_<wsid>_<ambiente>" → token
  private readonly tokenCache = new Map<string, CachedToken>();

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
    const { token, sign } = await this.getToken(apiKey, cuitNorm, ambiente, certPem, keyPem);

    const params = {
      Auth: { Token: token, Sign: sign, Cuit: cuitNorm },
      PtoVta: ptoVenta,
      CbteTipo: cbteTipo,
    };

    const response = await this.callAfipSdk(
      apiKey,
      ambiente,
      'wsfe',
      'FECompUltimoAutorizado',
      params,
      cuitNorm,
      tenantId,
      liquidacionId,
      facturaId,
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
  ): Promise<ArcaAutorizarResponse> {
    const cuitNorm = normalizeCuit(req.cuit);
    const { token, sign } = await this.getToken(apiKey, cuitNorm, req.ambiente, certPem, keyPem);

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
            ...(req.alicuotasIva?.length
              ? {
                  Iva: {
                    AlicIva: req.alicuotasIva.map((a) => ({
                      Id: a.Id,
                      BaseImp: round2(a.BaseImp),
                      Importe: round2(a.Importe),
                    })),
                  },
                }
              : {}),
          },
        },
      },
    };

    const response = await this.callAfipSdk(
      apiKey,
      req.ambiente,
      'wsfe',
      'FECAESolicitar',
      params,
      cuitNorm,
      tenantId,
      liquidacionId,
      facturaId,
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
        ? `Rechazado por AFIP: ${msgs.join(' ')}`
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

  private async getToken(
    apiKey: string,
    cuit: string,
    ambiente: ArcaAmbiente,
    certPem?: string | null,
    keyPem?: string | null,
  ): Promise<{ token: string; sign: string }> {
    const cuitNorm = normalizeCuit(cuit);
    const cacheKey = `${cuitNorm}_wsfe_${ambiente}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > new Date()) {
      return { token: cached.token, sign: cached.sign };
    }

    const start = Date.now();
    let httpStatus: number | undefined;

    const sdkEnv = toSdkEnv(ambiente);
    const certKey: Record<string, string> = {};
    if (certPem) certKey.cert = certPem;
    if (keyPem) certKey.key = keyPem;

    try {
      const res = await fetch(`${AFIP_SDK_BASE}/afip/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ environment: sdkEnv, tax_id: cuitNorm, wsid: 'wsfe', ...certKey }),
      });

      httpStatus = res.status;
      const body = await res.json() as ArcaTokenResponse & { error?: string; message?: string };

      if (!res.ok || !body.token) {
        const bodyStr = JSON.stringify(body);
        this.logger.error(`AFIP SDK auth HTTP ${res.status} | cuit=${cuitNorm} env=${sdkEnv} | body=${bodyStr}`);
        const errDetail = body?.error ?? body?.message ?? bodyStr;
        throw this.mapError(errDetail, res.status);
      }

      const expiresAt = new Date(body.expiration);
      // Resta 5 minutos para renovar antes del vencimiento real
      expiresAt.setMinutes(expiresAt.getMinutes() - 5);

      this.tokenCache.set(cacheKey, { token: body.token, sign: body.sign, expiresAt });
      this.logger.debug(`Token AFIP SDK obtenido para CUIT ${cuit} [${ambiente}]`);

      return { token: body.token, sign: body.sign };
    } catch (err) {
      if (err instanceof ArcaException) throw err;
      this.logger.error(`Error obteniendo token AFIP SDK: ${String(err)}`);
      throw new ArcaException(ARCA_ERROR_CODES.CONECTIVIDAD, 'No se pudo conectar con AFIP SDK', httpStatus, err);
    }
  }

  private async callAfipSdk(
    apiKey: string,
    ambiente: ArcaAmbiente,
    wsid: string,
    method: string,
    params: Record<string, unknown>,
    cuit: string,
    tenantId: string,
    liquidacionId?: string,
    facturaId?: string,
  ): Promise<Record<string, unknown>> {
    const requestBody = { environment: toSdkEnv(ambiente), method, wsid, params };
    const start = Date.now();
    let httpStatus: number | undefined;
    let responseBody: unknown;
    let exitoso = false;
    let errorMsg: string | undefined;

    try {
      const res = await fetch(`${AFIP_SDK_BASE}/afip/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      httpStatus = res.status;
      responseBody = await res.json();
      const body = responseBody as Record<string, unknown>;

      if (!res.ok) {
        const errMsg = this.extractErrorMessage(body, res.status);
        throw this.mapError(errMsg, res.status);
      }

      exitoso = true;
      return body;
    } catch (err) {
      if (!(err instanceof ArcaException)) {
        errorMsg = String(err);
        throw new ArcaException(ARCA_ERROR_CODES.CONECTIVIDAD, 'Sin respuesta de AFIP SDK', httpStatus, err);
      }
      errorMsg = err.message;
      throw err;
    } finally {
      // Log de auditoría — nunca se registra la apiKey
      const safeRequest = { ...requestBody, cuit: normalizeCuit(cuit) };
      if ((safeRequest.params as Record<string, unknown>)?.Auth) {
        (safeRequest.params as Record<string, unknown>).Auth = '***';
      }

      await (this.prisma as any).arcaLog.create({
        data: {
          tenantId,
          liquidacionId: liquidacionId ?? null,
          facturaId: facturaId ?? null,
          method,
          ambiente,
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

  private extractErrorMessage(body: Record<string, unknown>, status: number): string {
    // AFIP SDK puede devolver data_errors con mensajes por campo
    if (typeof body?.data_errors === 'object' && body.data_errors !== null) {
      const msgs = Object.values(body.data_errors as Record<string, unknown>)
        .filter((v): v is string => typeof v === 'string');
      if (msgs.length > 0) return msgs.join('. ');
    }
    const candidates = [body?.details, body?.description, body?.message, body?.error];
    for (const c of candidates) {
      if (typeof c === 'string' && c && !c.match(/^HTTP \d+$/i)) return c;
    }
    for (const c of candidates) {
      if (typeof c === 'string' && c) return c;
    }
    return `HTTP ${status}`;
  }

  private mapError(raw: string, httpStatus?: number): ArcaException {
    const lower = raw.toLowerCase();
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
      return new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        'AFIP / ARCA rechazó la solicitud. Verificá que el CUIT, el punto de venta y el certificado estén correctamente configurados.',
        httpStatus,
        raw,
      );
    }
    return new ArcaException(ARCA_ERROR_CODES.GENERICO, raw, httpStatus, raw);
  }
}
