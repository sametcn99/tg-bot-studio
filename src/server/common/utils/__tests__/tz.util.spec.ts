/**
 * Tests for the IANA time-zone scheduling helpers.
 * @module common/utils/__tests__/tz.util.spec
 */
import { describe, expect, it } from 'bun:test';
import {
  isValidTimeZone,
  nextZonedOccurrence,
  safeTimeZone,
  wallTimeToUtc,
  zonedParts,
} from '../tz.util';

describe('tz.util', () => {
  it('validates IANA zone names', () => {
    expect(isValidTimeZone('Europe/Istanbul')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('falls back to UTC for invalid zones', () => {
    expect(safeTimeZone('Not/AZone')).toBe('UTC');
    expect(safeTimeZone('Europe/Istanbul')).toBe('Europe/Istanbul');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });

  it('converts wall time to UTC across the UTC+3 zone', () => {
    // 18:00 in Istanbul (UTC+3, no DST since 2016) = 15:00 UTC.
    const instant = wallTimeToUtc('Europe/Istanbul', 2026, 6, 15, 18, 0);
    expect(instant.toISOString()).toBe('2026-06-15T15:00:00.000Z');
  });

  it('converts wall time to UTC for a negative-offset zone', () => {
    // 09:00 in New York (EDT, UTC-4 in June) = 13:00 UTC.
    const instant = wallTimeToUtc('America/New_York', 2026, 6, 15, 9, 0);
    expect(instant.toISOString()).toBe('2026-06-15T13:00:00.000Z');
  });

  it('describes zoned calendar parts with weekday', () => {
    const parts = zonedParts('UTC', new Date('2026-06-15T15:00:00.000Z')); // a Monday
    expect(parts.weekday).toBe(1);
    expect(parts.hours).toBe(15);
  });

  it('computes the next daily occurrence in a zone', () => {
    // Now: 2026-06-15T16:00Z (19:00 Istanbul). Target 18:00 Istanbul → tomorrow 15:00Z.
    const next = nextZonedOccurrence(
      'daily',
      'Europe/Istanbul',
      '18:00',
      0,
      new Date('2026-06-15T16:00:00.000Z'),
    );
    expect(next.toISOString()).toBe('2026-06-16T15:00:00.000Z');
  });

  it('keeps today when the wall time is still ahead', () => {
    // Now: 2026-06-15T12:00Z (15:00 Istanbul). Target 18:00 Istanbul → today 15:00Z.
    const next = nextZonedOccurrence(
      'daily',
      'Europe/Istanbul',
      '18:00',
      0,
      new Date('2026-06-15T12:00:00.000Z'),
    );
    expect(next.toISOString()).toBe('2026-06-15T15:00:00.000Z');
  });

  it('computes the next weekly occurrence for a target weekday', () => {
    // Monday 2026-06-15, target Friday at 18:00 Istanbul → 2026-06-19T15:00Z.
    const next = nextZonedOccurrence(
      'weekly',
      'Europe/Istanbul',
      '18:00',
      5,
      new Date('2026-06-15T10:00:00.000Z'),
    );
    expect(next.toISOString()).toBe('2026-06-19T15:00:00.000Z');
  });
});
