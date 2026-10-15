/**
 * reference-style duration parsing ("5m", "1h30m", "3d", "2w") shared by every
 * timed moderation action (tban/tmute, warn expiry, captcha kick timers, ...).
 * @module common/utils/duration
 */

/** Unit multipliers in seconds, matching the reference bot's supported time units. */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
};

/**
 * Parses a reference-style duration string into seconds.
 *
 * Accepts a single unit ("5m") or a compound sum ("1h30m", "1d12h").
 * A bare number is treated as minutes, mirroring lenient admin input.
 *
 * @param {string} input - Raw duration text (e.g. "3d", "1h30m").
 * @returns {number | null} Total seconds, or null when nothing parseable.
 * @example
 * parseDuration('1h30m'); // 5400
 * parseDuration('2w'); // 1209600
 * parseDuration('nope'); // null
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const bare = Number(text);
  if (Number.isFinite(bare) && bare > 0) return Math.round(bare * 60);

  const matches = [...text.matchAll(/(\d+)\s*(s|m|h|d|w)/g)];
  if (matches.length === 0) return null;

  let total = 0;
  for (const match of matches) {
    total += Number(match[1]) * UNIT_SECONDS[match[2]];
  }
  return total > 0 ? total : null;
}

/**
 * Splits "<duration> <rest>" command arguments into seconds and remainder.
 *
 * @param {string} input - Raw argument text, duration first (e.g. "3d time to cool off").
 * @returns {{ seconds: number | null, rest: string }} Parsed seconds (null when
 * the leading token is not a duration) plus the remaining reason text.
 * @example
 * splitDurationArg('3d cool off'); // { seconds: 259200, rest: 'cool off' }
 */
export function splitDurationArg(input: string): { seconds: number | null; rest: string } {
  const text = input.trim();
  if (!text) return { seconds: null, rest: '' };

  const bare = Number(text.split(/\s+/)[0]);
  if (Number.isFinite(bare) && !Number.isNaN(bare) && String(bare) === text.split(/\s+/)[0]) {
    return { seconds: bare > 0 ? Math.round(bare * 60) : null, rest: '' };
  }

  const match = text.match(/^(\d+\s*(?:s|m|h|d|w)(?:\s*\d+\s*(?:s|m|h|d|w))*)\s*(.*)$/i);
  if (!match) return { seconds: null, rest: text };

  const seconds = parseDuration(match[1].replace(/\s+/g, ''));
  return { seconds, rest: match[2].trim() };
}

/**
 * Formats a number of seconds back into a compact human duration string.
 *
 * @param {number} seconds - Duration in seconds.
 * @returns {string} Compact form using the largest fitting unit (e.g. "3d", "2h", "45m").
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  if (seconds % 604_800 === 0) return `${seconds / 604_800}w`;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${Math.round(seconds / 60)}m`;
}
