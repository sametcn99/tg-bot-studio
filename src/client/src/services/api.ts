/**
 * Typed fetch wrapper for the Studio REST API. Attaches the in-memory JWT
 * session token when present (same-origin requests are otherwise covered by
 * the HttpOnly `studio_session` cookie), unwraps the `{success, data}`
 * envelope, and surfaces a normalized error with server-provided messages.
 * The token is deliberately never persisted to storage: a page reload falls
 * back to cookie authentication and re-validates via `/api/auth/me`.
 * @module services/api
 */

/** Module-scoped session token — memory only, never written to storage. */
let memoryToken: string | null = null;

/**
 * Reads the in-memory session token.
 * @returns {string | null} JWT or null when signed out / cookie-only.
 */
export function getToken(): string | null {
  return memoryToken;
}

/**
 * Sets or clears the in-memory session token.
 * @param {string | null} token - JWT to keep for bearer requests, or null.
 * @returns {void}
 */
export function setToken(token: string | null): void {
  memoryToken = token;
}

/**
 * Normalized API error carrying the HTTP status.
 * @extends Error
 */
export class ApiError extends Error {
  /** HTTP status code (0 for network failures). */
  public readonly status: number;
  /** Machine-readable error code from the API (`VALIDATION_ERROR`, `NOT_FOUND`, ...). */
  public readonly code?: string;

  /**
   * @param {string} message - Human-readable error text.
   * @param {number} status - HTTP status code.
   * @param {string} [code] - Machine-readable code for localized messages.
   */
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Performs an authenticated JSON request and unwraps the envelope.
 * @template T - Expected response data shape.
 * @param {string} path - API path beginning with `/api/`.
 * @param {RequestInit} [init] - Optional fetch options (`method`, `body`).
 * @returns {Promise<T>} Unwrapped response data.
 * @throws {ApiError} When authentication fails, the server rejects, or the
 * network is unreachable.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401) {
    // Tear down and redirect only when the request was actually
    // authenticated; anonymous calls (login page) simply fail, otherwise
    // the redirect re-triggers forever and reload-loops the page.
    if (token) {
      setToken(null);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    throw new ApiError('Session expired', 401);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string | string[];
    code?: string;
  };
  if (!response.ok || payload.success === false) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : (payload.message ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status, payload.code);
  }
  return (payload.data ?? (payload as T)) as T;
}

/**
 * Performs a raw download (CSV/JSON export) and saves it as a file.
 * @param {string} path - API path beginning with `/api/`.
 * @param {string} filename - Download file name.
 * @returns {Promise<void>} Resolves once the browser download started.
 * @throws {ApiError} When the request fails.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = getToken();
  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new ApiError(`Download failed (${response.status})`, response.status);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
