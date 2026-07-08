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
  if (detail) return `Rechazado por AFIP: ${detail}`;
  return 'AFIP no autorizó el comprobante. Revisá los importes y la configuración de ARCA.';
}
