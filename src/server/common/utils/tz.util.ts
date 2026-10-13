/**
 * IANA time-zone helpers for scheduling. Pure stdlib (Intl) — no external
 * date libraries. Wall-clock ↔ UTC conversion uses the standard
 * formatToParts + offset-refinement technique, correct across DST edges.
 * @module common/utils/tz.util
 */

/** Calendar parts of an instant, expressed in a target time zone. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
}

/**
 * Validates an IANA time zone name against the runtime database.
 * @param {string} timeZone - Candidate zone name.
 * @returns {boolean} True when the zone is valid in this runtime.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the effective zone: the stored zone when valid, otherwise UTC.
 * @param {string | undefined} timeZone - Stored IANA zone (possibly empty/invalid).
 * @returns {string} A safe zone name.
 */
export function safeTimeZone(timeZone: string | undefined): string {
  if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  return 'UTC';
}

/**
 * Calendar parts of an instant in a target zone.
 * @param {string} timeZone - IANA zone.
 * @param {Date} date - Instant to describe.
 * @returns {ZonedParts} Wall-clock parts (weekday included).
 */
export function zonedParts(timeZone: string, date: Date): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) map[part.type] = part.value;
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hours: hour,
    minutes: Number(map.minute),
    weekday: Math.max(0, weekdayNames.indexOf(map.weekday)),
  };
}

/**
 * Offset of a zone from UTC at the given instant (ms east of UTC).
 * @param {string} timeZone - IANA zone.
 * @param {Date} date - Instant.
 * @returns {number} Offset in milliseconds (e.g. +10_800_000 for UTC+3).
 */
function zoneOffsetMs(timeZone: string, date: Date): number {
  const parts = zonedParts(timeZone, date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, 0, 0);
  const secondsPortion = date.getUTCSeconds();
  return asUtc - (date.getTime() - secondsPortion * 1000);
}

/**
 * Converts a wall-clock time in a zone to the corresponding UTC instant,
 * refining twice so DST boundaries resolve correctly.
 * @param {string} timeZone - IANA zone.
 * @param {number} year - Full year.
 * @param {number} month - 1-based month.
 * @param {number} day - Day of month.
 * @param {number} hours - 0-23.
 * @param {number} minutes - 0-59.
 * @returns {Date} UTC instant for that wall time.
 */
export function wallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  let instant = guess - zoneOffsetMs(timeZone, new Date(guess));
  instant = guess - zoneOffsetMs(timeZone, new Date(instant));
  return new Date(instant);
}

/**
 * Computes the next UTC instant at or after `from` matching a recurring
 * HH:mm (and optionally weekday) in the given zone.
 * @param {'daily' | 'weekly'} frequency - Recurrence shape.
 * @param {string} timeZone - IANA zone (invalid falls back to UTC).
 * @param {string} timeOfDay - 'HH:mm' wall time in the zone.
 * @param {number} [dayOfWeek] - 0-6 target weekday for weekly recurrence.
 * @param {Date} [from] - Reference instant (default now).
 * @returns {Date} Next occurrence as a UTC instant.
 */
export function nextZonedOccurrence(
  frequency: 'daily' | 'weekly',
  timeZone: string,
  timeOfDay: string,
  dayOfWeek = 0,
  from: Date = new Date(),
): Date {
  const zone = safeTimeZone(timeZone);
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeOfDay);
  const hours = match ? Number(match[1]) : 18;
  const minutes = match ? Number(match[2]) : 0;

  const nowParts = zonedParts(zone, from);
  const nowWallMinutes = nowParts.hours * 60 + nowParts.minutes;
  const targetWallMinutes = hours * 60 + minutes;

  const addDays =
    frequency === 'daily'
      ? targetWallMinutes > nowWallMinutes
        ? 0
        : 1
      : (() => {
          const delta = (dayOfWeek - nowParts.weekday + 7) % 7;
          return delta === 0 && targetWallMinutes <= nowWallMinutes ? 7 : delta;
        })();

  // Anchor Date.UTC on the zoned calendar date, then advance.
  const anchorUtcMidnight = Date.UTC(
    nowParts.year,
    nowParts.month - 1,
    nowParts.day + addDays,
    0,
    0,
    0,
    0,
  );
  const anchorParts = zonedParts(
    zone,
    new Date(anchorUtcMidnight - zoneOffsetMs(zone, new Date(anchorUtcMidnight))),
  );
  return wallTimeToUtc(zone, anchorParts.year, anchorParts.month, anchorParts.day, hours, minutes);
}
