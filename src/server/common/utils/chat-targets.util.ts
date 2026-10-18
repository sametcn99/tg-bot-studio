/**
 * Normalizes a chat-target payload field into a clean list of chat ids.
 * Accepts the legacy single value (string or number, numeric ids or
 * `@username`) and the multi-select array form, deduplicating while keeping
 * the first occurrence order.
 * @module common/utils/chat-targets
 */

/**
 * Normalizes one raw chat-target entry to its stored string form.
 * @param {unknown} entry - Raw entry (string, number, or anything else).
 * @returns {string | null} Normalized chat id, or null when unusable.
 */
function normalizeEntry(entry: unknown): string | null {
  if (typeof entry === 'number' && Number.isFinite(entry)) return String(entry);
  if (typeof entry !== 'string') return null;
  const trimmed = entry.trim();
  return trimmed ? trimmed : null;
}

/**
 * Normalizes a submitted target chat field (single id or id array) into a
 * deduplicated list of chat id strings.
 * @param {unknown} input - Raw payload value (`-100…`, `@username`, or array of them).
 * @returns {string[]} Unique chat ids in submission order (empty when none).
 */
export function normalizeChatTargets(input: unknown): string[] {
  const rawList = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawList) {
    const normalized = normalizeEntry(raw);
    if (normalized === null || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
