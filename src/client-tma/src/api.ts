import { webApp } from './sdk/telegram';

/**
 * API client for the Mini App runtime endpoints. Every request carries the
 * raw `initData` in the `X-Telegram-Init-Data` header for server-side
 * HMAC-SHA256 validation.
 * @module api
 */

/**
 * Normalized API error.
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
 * Performs a JSON request against the Mini App API.
 * @template T - Expected response data shape.
 * @param {string} path - API path beginning with `/api/`.
 * @param {RequestInit} [init] - Optional fetch options (`method`, `body`).
 * @returns {Promise<T>} Unwrapped response data.
 * @throws {ApiError} When the network call fails or the server rejects.
 */
export async function tmaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': webApp?.initData ?? '',
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string | string[];
  };
  if (!response.ok || payload.success === false) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : payload.message ?? `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return (payload.data ?? (payload as T)) as T;
}
