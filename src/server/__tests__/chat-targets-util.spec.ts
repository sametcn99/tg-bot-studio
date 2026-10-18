/**
 * Suite for the chat-target normalization util backing the multi-select
 * target pickers (scheduler fan-out, monetization sends).
 * @module __tests__/chat-targets-util.spec
 */
import { describe, expect, it } from 'bun:test';
import {
  isChatTargeted,
  normalizeChatTargets,
  SIMULATOR_GROUP_ID,
  SIMULATOR_TELEGRAM_ID,
} from '../common/utils/chat-targets.util';

describe('normalizeChatTargets', () => {
  it('wraps a legacy single string target into a one-element list', () => {
    expect(normalizeChatTargets('@mychannel')).toEqual(['@mychannel']);
  });

  it('wraps a legacy numeric target as its string form', () => {
    expect(normalizeChatTargets(-1001234567890)).toEqual(['-1001234567890']);
    expect(normalizeChatTargets('-1001234567890')).toEqual(['-1001234567890']);
  });

  it('keeps arrays of mixed numeric and username targets in order', () => {
    expect(normalizeChatTargets(['-1001', '@news', -1002])).toEqual(['-1001', '@news', '-1002']);
  });

  it('deduplicates repeated targets keeping first occurrence', () => {
    expect(normalizeChatTargets(['-1001', '-1001', '@news', '@news'])).toEqual(['-1001', '@news']);
  });

  it('drops empty, whitespace, and non-string/non-number entries', () => {
    expect(normalizeChatTargets(['', '   ', null, undefined, {}, 42])).toEqual(['42']);
  });

  it('returns an empty list for absent values', () => {
    expect(normalizeChatTargets(undefined)).toEqual([]);
    expect(normalizeChatTargets(null)).toEqual([]);
    expect(normalizeChatTargets('')).toEqual([]);
    expect(normalizeChatTargets([])).toEqual([]);
  });
});

describe('isChatTargeted', () => {
  it('matches numeric chat ids in string or number form', () => {
    expect(isChatTargeted(['-100123'], -100123)).toBe(true);
    expect(isChatTargeted(['-100123'], '-100123')).toBe(true);
  });

  it('matches @username targets', () => {
    expect(isChatTargeted(['@news'], '@news')).toBe(true);
  });

  it('rejects chats not on the list', () => {
    expect(isChatTargeted(['-100123'], -100999)).toBe(false);
  });

  it('treats an empty or missing list as targeted nowhere (no default)', () => {
    expect(isChatTargeted([], -100123)).toBe(false);
    expect(isChatTargeted(undefined, -100123)).toBe(false);
    expect(isChatTargeted(null, -100123)).toBe(false);
    expect(isChatTargeted('not-an-array', -100123)).toBe(false);
  });

  it('normalizes mixed-type lists before matching', () => {
    expect(isChatTargeted([-100123, '@news'], '-100123')).toBe(true);
  });

  it('always passes the reserved sandbox simulator ids', () => {
    expect(isChatTargeted([], SIMULATOR_TELEGRAM_ID)).toBe(true);
    expect(isChatTargeted(undefined, SIMULATOR_GROUP_ID)).toBe(true);
    expect(isChatTargeted(['-100123'], String(SIMULATOR_GROUP_ID))).toBe(true);
  });
});
