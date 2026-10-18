/**
 * Suite for the chat-target normalization util backing the multi-select
 * target pickers (scheduler fan-out, monetization sends).
 * @module __tests__/chat-targets-util.spec
 */
import { describe, expect, it } from 'bun:test';
import { normalizeChatTargets } from '../common/utils/chat-targets.util';

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
