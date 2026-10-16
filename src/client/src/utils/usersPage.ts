/**
 * Parser for the Audience CRM list endpoint. The server responds with
 * `{ items, total, page, pageSize }`; older deployments returned a bare
 * (fully filtered) array — both shapes are normalized here.
 * @module utils/usersPage
 */

/** Normalized page of CRM subscribers. */
export interface UsersPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Normalizes the users list payload into a page object.
 * @template T - Subscriber row shape.
 * @param {unknown} payload - Raw response data.
 * @param {number} requestedPage - 1-based page that was requested.
 * @param {number} requestedPageSize - Page size that was requested.
 * @returns {UsersPage<T>} Normalized page (legacy arrays report full totals).
 */
export function parseUsersPage<T>(
  payload: unknown,
  requestedPage: number,
  requestedPageSize: number,
): UsersPage<T> {
  if (Array.isArray(payload)) {
    return {
      items: payload as T[],
      total: payload.length,
      page: requestedPage,
      pageSize: requestedPageSize,
    };
  }
  const shape = (payload ?? {}) as {
    items?: T[];
    total?: number;
    page?: number;
    pageSize?: number;
  };
  const items = Array.isArray(shape.items) ? shape.items : [];
  return {
    items,
    total: typeof shape.total === 'number' ? shape.total : items.length,
    page: typeof shape.page === 'number' ? shape.page : requestedPage,
    pageSize: typeof shape.pageSize === 'number' ? shape.pageSize : requestedPageSize,
  };
}
