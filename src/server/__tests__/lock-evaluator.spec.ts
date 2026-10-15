import { describe, expect, test } from 'bun:test';
import { evaluateLocks, isAllowlisted, matchesLock } from '../modules/locks/lock-evaluator';
import type { Message } from 'grammy/types';

const CHAT = -100123;

function msg(partial: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: CHAT, type: 'supergroup', title: 'T' },
    ...partial,
  } as Message;
}

describe('matchesLock', () => {
  test('media types', () => {
    expect(
      matchesLock(
        'photo',
        msg({ photo: [{ file_id: 'x', file_unique_id: 'x', width: 1, height: 1 }] }),
        CHAT,
      ),
    ).toBe(true);
    expect(
      matchesLock(
        'sticker',
        msg({
          sticker: {
            file_id: 'x',
            file_unique_id: 'x',
            width: 1,
            height: 1,
            is_animated: true,
            is_video: false,
            type: 'regular',
          },
        }),
        CHAT,
      ),
    ).toBe(true);
    expect(
      matchesLock(
        'stickeranimated',
        msg({
          sticker: {
            file_id: 'x',
            file_unique_id: 'x',
            width: 1,
            height: 1,
            is_animated: true,
            is_video: false,
            type: 'regular',
          },
        }),
        CHAT,
      ),
    ).toBe(true);
    expect(
      matchesLock(
        'gif',
        msg({ animation: { file_id: 'x', file_unique_id: 'x', width: 1, height: 1, duration: 1 } }),
        CHAT,
      ),
    ).toBe(true);
  });

  test('url and invitelink', () => {
    const m = msg({ text: 'visit https://example.com now' });
    expect(matchesLock('url', m, CHAT)).toBe(true);
    const invite = msg({ text: 'join t.me/mygroup' });
    expect(matchesLock('invitelink', invite, CHAT)).toBe(true);
    expect(matchesLock('url', invite, CHAT)).toBe(false);
  });

  test('script locks', () => {
    expect(matchesLock('rtl', msg({ text: 'مرحبا' }), CHAT)).toBe(true);
    expect(matchesLock('cyrillic', msg({ text: 'привет' }), CHAT)).toBe(true);
    expect(matchesLock('cjk', msg({ text: 'こんにちは' }), CHAT)).toBe(true);
    expect(matchesLock('zalgo', msg({ text: 'Z̸̢̓a̷l̶g̵o̷' }), CHAT)).toBe(true);
  });

  test('anonchannel excludes anonymous admin senders', () => {
    expect(
      matchesLock(
        'anonchannel',
        msg({ sender_chat: { id: 555, type: 'channel', title: 'C' } }),
        CHAT,
      ),
    ).toBe(true);
    expect(
      matchesLock(
        'anonchannel',
        msg({ sender_chat: { id: CHAT, type: 'supergroup', title: 'G' } }),
        CHAT,
      ),
    ).toBe(false);
  });

  test('forward variants', () => {
    const m = msg({
      forward_origin: {
        type: 'channel',
        date: 0,
        chat: { id: 9, type: 'channel', title: 'C' },
        message_id: 1,
      },
    });
    expect(matchesLock('forward', m, CHAT)).toBe(true);
    expect(matchesLock('forwardchannel', m, CHAT)).toBe(true);
    expect(matchesLock('forwarduser', m, CHAT)).toBe(false);
  });
});

describe('evaluateLocks', () => {
  test('returns violated subset', () => {
    const violated = evaluateLocks(
      ['url', 'photo', 'rtl'],
      msg({ text: 'https://x.com hi' }),
      CHAT,
    );
    expect(violated).toEqual(['url']);
  });
});

describe('isAllowlisted', () => {
  test('bare domain allows urls', () => {
    expect(isAllowlisted(['example.com'], msg({ text: 'see https://example.com/a' }))).toBe(true);
    expect(isAllowlisted(['other.com'], msg({ text: 'see https://example.com/a' }))).toBe(false);
  });

  test('stickerpack entries', () => {
    const m = msg({
      sticker: {
        file_id: 'x',
        file_unique_id: 'x',
        width: 1,
        height: 1,
        is_animated: false,
        is_video: false,
        type: 'regular',
        set_name: 'Ducks',
      },
    });
    expect(isAllowlisted(['stickerpack:ducks'], m)).toBe(true);
  });

  test('command entries', () => {
    const m = msg({
      text: '/rules@somebot',
      entities: [{ offset: 0, length: 6, type: 'bot_command' }],
    });
    expect(isAllowlisted(['command:/rules'], m)).toBe(true);
  });
});
