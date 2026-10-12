/**
 * Minimal CSV serialization used by CRM, form submission, and order exports.
 * @module common/utils/csv
 */

/**
 * Escapes a single CSV field, quoting values that contain separators,
 * quotes, or newlines.
 * @param {unknown} value - Raw field value of any primitive type.
 * @returns {string} Safe CSV cell representation.
 */
function escapeCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes an array of records into an RFC 4180 compliant CSV document.
 *
 * @param {Record<string, unknown>[]} rows - Records to export; keys become the header.
 * @param {string[]} [columns] - Optional explicit column order; defaults to the keys of the first row.
 * @returns {string} Full CSV document including the header row.
 * @example
 * toCsv([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
 */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const header = columns ?? Object.keys(rows[0]);
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(header.map((column) => escapeCell(row[column])).join(','));
  }
  return lines.join('\r\n');
}
