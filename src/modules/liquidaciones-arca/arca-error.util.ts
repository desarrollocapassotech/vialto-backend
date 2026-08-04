type AfipErrLike = { Code?: unknown; Msg?: unknown; Message?: unknown };

function collectMsgs(items: AfipErrLike[] | undefined): string[] {
  if (!items?.length) return [];
  return items
    .map((e) => {
      const msg = e.Msg ?? e.Message;
      return typeof msg === 'string' ? msg.trim() : '';
    })
    .filter(Boolean);
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Mensajes de transporte (Axios/HTTP) sin info de negocio AFIP. */
function isTransportNoise(msg: string): boolean {
  const t = msg.trim();
  if (!t) return true;
  if (/^http\s*4\d\d$/i.test(t)) return true;
  if (/^request failed with status code\s*\d+$/i.test(t)) return true;
  if (/^network error$/i.test(t)) return true;
  return false;
}

function withAfipCode(code: unknown, msg: string): string {
  if (code == null || code === '') return msg;
  const codeStr = String(code);
  if (msg.includes(codeStr)) return msg;
  return `[${codeStr}] ${msg}`;
}

/** Extrae mensajes legibles de una respuesta FECAESolicitar (sin JSON crudo). */
export function extractAfipRejectionMessage(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const root = response as Record<string, unknown>;
  const solResult = (root.FECAESolicitarResult ?? root) as Record<string, unknown>;

  const errors = (solResult.Errors as Record<string, unknown> | undefined)?.Err;
  const fromErrors = collectMsgs(asArray(errors as AfipErrLike | AfipErrLike[]));
  if (fromErrors.length) {
    const first = asArray(errors as AfipErrLike | AfipErrLike[])[0];
    const code = first?.Code;
    return withAfipCode(code, fromErrors.join(' '));
  }

  const detResp = solResult.FeDetResp as Record<string, unknown> | undefined;
  const detArr = detResp?.FECAEDetResponse;
  const det = asArray(detArr as Record<string, unknown> | Record<string, unknown>[])[0];
  if (!det) return null;

  const obs = (det.Observaciones as Record<string, unknown> | undefined)?.Obs;
  const fromObs = collectMsgs(asArray(obs as AfipErrLike | AfipErrLike[]));
  if (fromObs.length) {
    const first = asArray(obs as AfipErrLike | AfipErrLike[])[0];
    return withAfipCode(first?.Code, fromObs.join(' '));
  }

  return null;
}

/** Busca texto de negocio en cuerpos típicos del proxy AFIP SDK / Axios. */
function extractFromUnknownPayload(payload: unknown, depth = 0): string | null {
  if (payload == null || depth > 4) return null;

  if (typeof payload === 'string') {
    const t = payload.trim();
    if (!t || isTransportNoise(t)) return null;
    // JSON embebido
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return extractFromUnknownPayload(JSON.parse(t), depth + 1);
      } catch {
        return t;
      }
    }
    return t;
  }

  if (typeof payload !== 'object') return null;

  const fromAfip = extractAfipRejectionMessage(payload);
  if (fromAfip) return fromAfip;

  const obj = payload as Record<string, unknown>;

  // Errors.Err plano (AFIP)
  const errs = (obj.Errors as Record<string, unknown> | undefined)?.Err;
  const fromErrs = collectMsgs(asArray(errs as AfipErrLike | AfipErrLike[]));
  if (fromErrs.length) {
    const first = asArray(errs as AfipErrLike | AfipErrLike[])[0];
    return withAfipCode(first?.Code, fromErrs.join(' '));
  }

  // Proxies / Nest-like: message | error | msg | detail
  for (const key of ['message', 'error', 'msg', 'Msg', 'detail', 'Description'] as const) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() && !isTransportNoise(v)) {
      return withAfipCode(obj.code ?? obj.Code, v.trim());
    }
    if (Array.isArray(v)) {
      const joined = v
        .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
        .join(' ');
      if (joined && !isTransportNoise(joined)) return joined;
    }
  }

  // Anidar en data / body / result / response (común en Axios + proxy SDK)
  for (const key of ['data', 'body', 'result', 'response', 'FECAESolicitarResult'] as const) {
    if (key in obj) {
      const nested = extractFromUnknownPayload(obj[key], depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Detalle usable a partir de un error lanzado por el AFIP SDK / Axios (HTTP 4xx).
 * Prioriza `response.data` (cuerpo real); ignora "Request failed with status code 400".
 */
export function extractAfipSdkErrorDetail(raw: unknown): string | null {
  if (raw == null) return null;

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;

    // Axios: response.data es donde suele estar el rechazo de AFIP SDK
    const axiosData = (obj.response as Record<string, unknown> | undefined)?.data;
    const fromAxios = extractFromUnknownPayload(axiosData);
    if (fromAxios) return fromAxios;

    const fromSelf = extractFromUnknownPayload(obj);
    if (fromSelf) return fromSelf;

    const code = obj.code ?? obj.Code;
    const msg =
      (typeof obj.message === 'string' && obj.message.trim()) ||
      (typeof obj.Msg === 'string' && obj.Msg.trim()) ||
      '';
    if (msg && !isTransportNoise(msg)) {
      return withAfipCode(code, msg);
    }
    if (code != null && code !== '') return `Código AFIP ${String(code)}`;
  }

  const asStr = String(raw).trim();
  if (!asStr || isTransportNoise(asStr)) return null;
  return asStr;
}

export function formatAfipRejectionForUser(response: unknown): string {
  const detail = extractAfipRejectionMessage(response);
  if (detail) return enrichAfipRejectionMessage(`Rechazado por AFIP: ${detail}`);
  return 'AFIP no autorizó el comprobante. Revisá los importes y la configuración de ARCA.';
}

/** Agrega contexto operativo a códigos AFIP frecuentes. */
export function enrichAfipRejectionMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('11002') || lower.includes('feParamGetPtosVenta'.toLowerCase())) {
    return (
      `${message} El punto de venta configurado en "Pto. venta Factura A/B" no está habilitado en AFIP ` +
      'homologación para Factura electrónica (WSFE). En AFIP, dá de alta o habilitá un punto de venta ' +
      'para Facturas A/B y actualizá ese número en Superadmin → ARCA / AFIP.'
    );
  }
  return message;
}

/** Detalle legible desde errores HTTP del cliente AfipSDK (axios: err.data). */
export function extractAfipSdkHttpError(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const root = err as Record<string, unknown>;
  const data = root.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (!data || typeof data !== 'object') return null;

  const d = data as Record<string, unknown>;
  const candidates = [d.message, d.error, d.detail, d.title];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  if (Array.isArray(d.errors)) {
    const msgs = d.errors
      .map((e) => {
        if (typeof e === 'string') return e.trim();
        if (e && typeof e === 'object') {
          const o = e as Record<string, unknown>;
          const m = o.message ?? o.msg ?? o.detail;
          return typeof m === 'string' ? m.trim() : '';
        }
        return '';
      })
      .filter(Boolean);
    if (msgs.length) return msgs.join(' ');
  }
  try {
    const compact = JSON.stringify(data);
    if (compact.length <= 500) return compact;
  } catch {
    // ignore
  }
  return null;
}
