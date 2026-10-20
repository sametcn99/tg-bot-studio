import { Logger } from '@nestjs/common';

const logger = new Logger('JsonUtil');

/**
 * Safe decode for JSON persisted in `*_json` columns. A corrupted or
 * hand-edited row must degrade to the fallback instead of throwing deep in a
 * request handler — and must be visible in logs so the bad row can be fixed.
 * @param {string | null | undefined} raw - Persisted JSON text.
 * @param {Record<string, unknown>} fallback - Value returned on any failure.
 * @param {string} [context] - Short label included in the warning log.
 * @returns {Record<string, unknown>} Parsed object or the fallback.
 */
export function safeJsonObjectParse<T = Record<string, unknown>>(
  raw: string | null | undefined,
  fallback: Record<string, unknown> = {},
  context?: string,
): T {
  if (!raw) return fallback as unknown as T;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // fall through to the warning below
  }
  logger.warn(`Malformed JSON blob ignored${context ? ` at ${context}` : ''}`);
  return fallback as unknown as T;
}

/**
 * Generic safe decode for JSON persisted in `*_json` columns when the expected
 * shape is not a plain object (arrays, strings, numbers).
 * @template T - Expected decoded shape.
 * @param {string | null | undefined} raw - Persisted JSON text.
 * @param {T} fallback - Value returned on any failure.
 * @param {string} [context] - Short label included in the warning log.
 * @returns {T} Parsed value or the fallback.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T, context?: string): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.warn(`Malformed JSON ignored${context ? ` at ${context}` : ''}`);
    return fallback;
  }
}
