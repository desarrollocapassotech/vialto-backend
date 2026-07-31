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

/** Extrae mensajes legibles de una respuesta FECAESolicitar (sin JSON crudo). */
export function extractAfipRejectionMessage(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const root = response as Record<string, unknown>;
  const solResult = (root.FECAESolicitarResult ?? root) as Record<string, unknown>;

  const errors = (solResult.Errors as Record<string, unknown> | undefined)?.Err;
  const fromErrors = collectMsgs(asArray(errors as AfipErrLike | AfipErrLike[]));
  if (fromErrors.length) return fromErrors.join(' ');

  const detResp = solResult.FeDetResp as Record<string, unknown> | undefined;
  const detArr = detResp?.FECAEDetResponse;
  const det = asArray(detArr as Record<string, unknown> | Record<string, unknown>[])[0];
  if (!det) return null;

  const obs = (det.Observaciones as Record<string, unknown> | undefined)?.Obs;
  const fromObs = collectMsgs(asArray(obs as AfipErrLike | AfipErrLike[]));
  if (fromObs.length) return fromObs.join(' ');

  return null;
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
