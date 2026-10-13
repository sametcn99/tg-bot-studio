/**
 * Typed fetch wrapper for the Studio REST API. Attaches the JWT session
 * token, unwraps the `{success, data}` envelope, and surfaces a normalized
 * error with server-provided messages.
 * @module services/api
 */

/** Local storage key holding the dashboard JWT. */
const TOKEN_KEY = 'studio-token';

/**
 * Normalized API error carrying the HTTP status.
 * @extends Error
 */
export class ApiError extends Error {
  /** HTTP status code (0 for network failures). */
  public readonly status: number;

  /**
   * @param {string} message - Human-readable error text.
   * @param {number} status - HTTP status code.
   */
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Reads the stored session token.
 * @returns {string | null} JWT or null when signed out.
 */
export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

/**
 * Persists or clears the session token.
 * @param {string | null} token - JWT to store, or null to sign out.
 * @returns {void}
 */
export function setToken(token: string | null): void {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
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
  };
  if (!response.ok || payload.success === false) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : (payload.message ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status);
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
