import { Logger } from '@nestjs/common';

const logger = new Logger('DbRetry');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 150;

/**
 * Detects SQLite write-contention errors (`SQLITE_BUSY` / lock timeouts).
 * WAL mode serializes writers; under concurrent broadcast + poller writes a
 * statement can exceed `busy_timeout`, and a single blind failure must not
 * lose the write.
 * @param {unknown} error - Thrown error from a Prisma call.
 * @returns {boolean} True when the error is a transient busy/lock conflict.
 */
export function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (code === 'P2034' || code === 'P2024') return true;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes('sqlite_busy') || lower.includes('database is locked');
}

/**
 * Runs a database operation, retrying transient SQLite busy/lock errors with
 * jittered backoff. Non-busy errors propagate immediately.
 * @template T
 * @param {() => Promise<T>} fn - Operation to run.
 * @param {string} [context] - Label used in retry warnings.
 * @returns {Promise<T>} Result of the first successful attempt.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, context?: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt === MAX_RETRIES) throw error;
      lastError = error;
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 100;
      logger.warn(
        `Database busy${context ? ` (${context})` : ''}, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
