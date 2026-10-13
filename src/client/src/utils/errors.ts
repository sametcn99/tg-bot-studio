import i18n from '../i18n';
import { ApiError } from '../services/api';

/**
 * Returns a user-facing message for an error, preferring the localized
 * `errors.<code>` catalog entry when the API supplied a machine-readable
 * code. Falls back to the raw (English) server message.
 * @param {unknown} err - Thrown value (usually ApiError).
 * @returns {string} Display message in the active UI language.
 */
export function localizedErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code && i18n.exists(`errors.${err.code}`)) {
    return i18n.t(`errors.${err.code}`);
  }
  return err instanceof Error ? err.message : String(err);
}
