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

const AFIP_SDK_BASE = 'https://app.afipsdk.com/api/v1';

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
  ): Promise<ArcaLastVoucherResponse> {
    const { token, sign } = await this.getToken(apiKey, cuit, ambiente);

    const params = {
      Auth: { Token: token, Sign: sign, Cuit: cuit },
      PtoVta: ptoVenta,
      CbteTipo: cbteTipo,
    };

    const response = await this.callAfipSdk(
      apiKey,
      ambiente,
      'wsfe',
      'FECompUltimoAutorizado',
      params,
      cuit,
      tenantId,
      liquidacionId,
      facturaId,
    );

    return { CbteNro: (response?.CbteNro as number | undefined) ?? 0 };
  }

  async autorizarComprobante(
    apiKey: string,
    req: ArcaAutorizarRequest,
    tenantId: string,
    liquidacionId?: string,
    facturaId?: string,
  ): Promise<ArcaAutorizarResponse> {
    const { token, sign } = await this.getToken(apiKey, req.cuit, req.ambiente);

    const params = {
      Auth: { Token: token, Sign: sign, Cuit: req.cuit },
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
      req.cuit,
      tenantId,
      liquidacionId,
      facturaId,
    );

    if (!response?.CAE) {
      throw new ArcaException(
        ARCA_ERROR_CODES.GENERICO,
        'AFIP SDK no devolvió CAE en la respuesta',
        undefined,
        response,
      );
    }

    return {
      CAE: String(response.CAE),
      CAEFchVto: String(response.CAEFchVto),
    };
  }

  // ── Privado: token y request base ──────────────────────────────────────────

  private async getToken(
    apiKey: string,
    cuit: string,
    ambiente: ArcaAmbiente,
  ): Promise<{ token: string; sign: string }> {
    const cacheKey = `${cuit}_wsfe_${ambiente}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > new Date()) {
      return { token: cached.token, sign: cached.sign };
    }

    const start = Date.now();
    let httpStatus: number | undefined;

    try {
      const res = await fetch(`${AFIP_SDK_BASE}/afip/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ environment: ambiente, tax_id: cuit, wsid: 'wsfe' }),
      });

      httpStatus = res.status;
      const body = await res.json() as ArcaTokenResponse & { error?: string };

      if (!res.ok || !body.token) {
        throw this.mapError(body?.error ?? `HTTP ${res.status}`, res.status);
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
    const requestBody = { environment: ambiente, method, wsid, params };
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
      const safeRequest = { ...requestBody };
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
    if (typeof body?.message === 'string') return body.message;
    if (typeof body?.error === 'string') return body.error;
    return `Error HTTP ${status}`;
  }

  private mapError(raw: string, httpStatus?: number): ArcaException {
    const lower = raw.toLowerCase();
    if (lower.includes('cuit') && lower.includes('inváli')) {
      return new ArcaException(ARCA_ERROR_CODES.CUIT_INVALIDO, 'El CUIT informado es inválido', httpStatus, raw);
    }
    if (lower.includes('certificado') && (lower.includes('vencido') || lower.includes('expirado'))) {
      return new ArcaException(ARCA_ERROR_CODES.CERT_VENCIDO, 'El certificado de ARCA está vencido. Renovarlo en el portal de AFIP SDK.', httpStatus, raw);
    }
    if (lower.includes('fuera de rango') || lower.includes('número inválido')) {
      return new ArcaException(ARCA_ERROR_CODES.FUERA_DE_RANGO, 'El número de comprobante está fuera de rango', httpStatus, raw);
    }
    if (lower.includes('duplicado') || lower.includes('already exists')) {
      return new ArcaException(ARCA_ERROR_CODES.COMPROBANTE_DUPLICADO, 'El comprobante ya fue autorizado anteriormente', httpStatus, raw);
    }
    if (httpStatus === 0 || lower.includes('timeout') || lower.includes('econnrefused') || lower.includes('network')) {
      return new ArcaException(ARCA_ERROR_CODES.CONECTIVIDAD, 'AFIP SDK no respondió. El comprobante quedó en estado pendiente_cae para reintentar.', httpStatus, raw);
    }
    return new ArcaException(ARCA_ERROR_CODES.GENERICO, raw, httpStatus, raw);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
