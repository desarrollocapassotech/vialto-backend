export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PaginatedMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginatedMeta;
}

/** Calcula skip/take a partir de page/pageSize (usa 1 y 10 si no vienen). */
export function paginate(page?: number, pageSize?: number): PaginationParams {
  const resolvedPage = page ?? 1;
  const resolvedPageSize = pageSize ?? 10;

  return {
    page: resolvedPage,
    pageSize: resolvedPageSize,
    skip: (resolvedPage - 1) * resolvedPageSize,
    take: resolvedPageSize,
  };
}

/** Arma la respuesta { items, meta } a partir de los resultados ya consultados. */
export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    meta: {
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
  };
}