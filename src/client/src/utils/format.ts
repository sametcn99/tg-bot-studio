import i18n from '../i18n';

/**
 * Locale-aware date-time formatting for table cells and headers, replacing
 * raw `slice(0, 19)` ISO strings. Falls back to the raw value when unparsable.
 * @param {string | number | Date | null | undefined} value - Date-ish value.
 * @returns {string} Localized "medium" date with short time, or em-dash.
 */
export function formatDateTime(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Locale-aware date formatting (no time component).
 * @param {string | number | Date | null | undefined} value - Date-ish value.
 * @returns {string} Localized date, or em-dash when empty.
 */
export function formatDate(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(date);
}

/**
 * Locale-aware number formatting (thousand separators etc.).
 * @param {number | null | undefined} value - Numeric value.
 * @returns {string} Localized number, or em-dash when empty.
 */
export function formatNumber(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(i18n.language).format(value);
}
