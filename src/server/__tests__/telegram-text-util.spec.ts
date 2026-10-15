import { describe, expect, test } from 'bun:test';
import {
  escapeHtml,
  normalizeText,
  resolveTarget,
  userMentionHtml,
} from '../common/utils/telegram-text.util';

describe('escapeHtml', () => {
  test('neutralizes html-significant characters', () => {
    expect(escapeHtml('a<b>&c>')).toBe('a&lt;b&gt;&amp;c&gt;');
  });
});

describe('userMentionHtml', () => {
  test('prefers username', () => {
    expect(
      userMentionHtml({ id: 1, is_bot: false, first_name: 'Ada' } as never),
    ).toBe('<a href="tg://user?id=1">Ada</a>');
  });

  test('falls back to invisible mention link', () => {
    const user = { id: 7, is_bot: false, first_name: 'Ada', username: 'ada_dev' } as never;
    expect(userMentionHtml(user)).toBe('@ada_dev');
  });
});

describe('resolveTarget', () => {
  const replyUser = { id: 99, is_bot: false, first_name: 'Bob' } as never;

  test('parses numeric ids with reason', () => {
    expect(resolveTarget('1234 spam', undefined)).toEqual({ userId: 1234, rest: 'spam' });
  });

  test('parses usernames', () => {
    expect(resolveTarget('@john flooding', undefined)).toEqual({
      username: 'john',
      rest: 'flooding',
    });
  });

  test('falls back to the replied user', () => {
    expect(resolveTarget('', replyUser)).toEqual({ userId: 99, rest: '' });
    expect(resolveTarget('only a reason', replyUser)).toEqual({
      userId: 99,
      rest: 'only a reason',
    });
  });

  test('returns plain rest without any target', () => {
    expect(resolveTarget('just text', undefined)).toEqual({ rest: 'just text' });
  });
});

describe('normalizeText', () => {
  test('strips accents and collapses whitespace', () => {
    expect(normalizeText('Hî  thérê')).toBe('hi there');
  });
});
