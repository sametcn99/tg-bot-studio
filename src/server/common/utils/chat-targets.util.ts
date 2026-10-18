/**
 * Normalizes a submitted target chat field (single id or id array) into a
 * deduplicated list of chat id strings, and the target-scope predicate
 * consumed by every chat-operating module runtime.
 * @module common/utils/chat-targets
 */

/**
 * Reserved Telegram user id representing the sandbox tester (int32-safe).
 * The studio simulator feeds synthetic updates through these ids, so target
 * gates always let them pass — sandbox testing never requires targeting.
 */
export const SIMULATOR_TELEGRAM_ID = 2_000_000_000;

/** Reserved chat id representing the sandbox supergroup (int32-safe). */
export const SIMULATOR_GROUP_ID = -100_200_000_000;

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

/**
 * Evaluates whether a chat is among a module's explicitly configured target
 * chats. No implicit default: an empty or missing list means the module is
 * not targeted anywhere and must stay idle in that chat.
 * @param {unknown} targetChats - Config value of the `targetChats` key.
 * @param {string | number} chatId - Chat id the event came from.
 * @returns {boolean} True only when the chat is explicitly listed.
 */
export function isChatTargeted(targetChats: unknown, chatId: string | number): boolean {
  // Sandbox simulator: synthetic updates always pass so studio-side testing
  // works without adding the reserved ids to every module's target list.
  const raw = String(chatId);
  if (raw === String(SIMULATOR_TELEGRAM_ID) || raw === String(SIMULATOR_GROUP_ID)) return true;
  if (!Array.isArray(targetChats) || targetChats.length === 0) return false;
  return normalizeChatTargets(targetChats).includes(raw);
}
