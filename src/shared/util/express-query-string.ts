import type { Request } from 'express';

/** Primer valor string de `req.query[name]` (Express puede devolver `string | string[]`). */
export function firstQueryString(
  query: Request['query'],
  name: string,
): string | undefined {
  const v = query[name];
  if (v == null) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

/** Parsea `?a=1&b=2` desde `req.url` / `req.originalUrl` (respaldo si `req.query` viene vacío en Nest). */
function firstQueryStringFromUrl(url: string | undefined, name: string): string | undefined {
  if (typeof url !== 'string' || !url.includes('?')) return undefined;
  const q = url.indexOf('?');
  const params = new URLSearchParams(url.slice(q + 1));
  const v = params.get(name);
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

/**
 * Obtiene un parámetro GET de forma robusta: primero `req.query`, luego parseando la URL
 * (en algunos entornos Nest/Express `req.query` no refleja la querystring para este handler).
 */
export function queryParamFromRequest(req: Request, name: string): string | undefined {
  return (
    firstQueryString(req.query, name) ??
    firstQueryStringFromUrl(req.originalUrl, name) ??
    firstQueryStringFromUrl(req.url, name)
  );
}
