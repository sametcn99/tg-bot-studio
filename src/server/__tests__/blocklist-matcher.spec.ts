import { describe, expect, test } from 'bun:test';
import { matchBlocklist } from '../modules/moderation/blocklist-matcher';
import type { Message, User } from 'grammy/types';

const USER: User = {
  id: 10,
  is_bot: false,
  first_name: 'Ada',
  last_name: 'Lovelace',
  username: 'ada',
};

function msg(partial: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: -1, type: 'supergroup', title: 'T' },
    ...partial,
  } as Message;
}

describe('matchBlocklist', () => {
  test('plain word matches on word boundaries', () => {
    expect(matchBlocklist(['hi'], msg({ text: 'hi there' }), USER)).not.toBeNull();
    expect(matchBlocklist(['hi'], msg({ text: 'this is fine' }), USER)).toBeNull();
  });

  test('accent and case normalization', () => {
    expect(matchBlocklist(['hello'], msg({ text: 'HÊLLÖ world' }), USER)).not.toBeNull();
  });

  test('wildcards', () => {
    expect(matchBlocklist(['bit?'], msg({ text: 'bits and bytes' }), USER)).not.toBeNull();
    expect(matchBlocklist(['bit?'], msg({ text: 'bit' }), USER)).toBeNull();
    expect(matchBlocklist(['bit*'], msg({ text: 'bite me' }), USER)).not.toBeNull();
    expect(
      matchBlocklist(['hi ** you'], msg({ text: 'hi there, how are you' }), USER),
    ).not.toBeNull();
  });

  test('prefix and exact modes', () => {
    expect(matchBlocklist(['prefix:buy'], msg({ text: 'buy now coins' }), USER)).not.toBeNull();
    expect(matchBlocklist(['prefix:buy'], msg({ text: 'go buy' }), USER)).toBeNull();
    expect(matchBlocklist(['exact:hi there'], msg({ text: 'hi there' }), USER)).not.toBeNull();
    expect(matchBlocklist(['exact:hi there'], msg({ text: 'well hi there' }), USER)).toBeNull();
  });

  test('lookalike folding', () => {
    expect(matchBlocklist(['lookalike:bot'], msg({ text: 'b0t spam' }), USER)).not.toBeNull();
    expect(matchBlocklist(['lookalike:spam'], msg({ text: 'sp4m here' }), USER)).not.toBeNull();
  });

  test('name and username triggers', () => {
    expect(matchBlocklist(['name:*ham*'], msg({ text: 'hello' }), USER)).toBeNull();
    expect(matchBlocklist(['name:*love*'], msg({ text: 'hello' }), USER)).not.toBeNull();
    expect(matchBlocklist(['username:ad'], msg({ text: 'hello' }), USER)).not.toBeNull();
  });

  test('file triggers with wildcards', () => {
    const m = msg({ document: { file_id: 'x', file_unique_id: 'x', file_name: 'virus.exe' } });
    expect(matchBlocklist(['file:*.exe'], m, USER)).not.toBeNull();
    expect(matchBlocklist(['file:*.pdf'], m, USER)).toBeNull();
  });

  test('per-entry actions parse out of the trigger', () => {
    const hit = matchBlocklist(['badword {ban}'], msg({ text: 'a badword here' }), USER);
    expect(hit?.action).toBe('ban');
    const timed = matchBlocklist(['badword {tmute 2h}'], msg({ text: 'a badword here' }), USER);
    expect(timed?.action).toBe('tmute');
    expect(timed?.durationSeconds).toBe(7_200);
  });

  test('escaped wildcards stay literal', () => {
    expect(matchBlocklist(['what\\*ever'], msg({ text: 'what*ever ok' }), USER)).not.toBeNull();
    expect(matchBlocklist(['what\\*ever'], msg({ text: 'whatever ok' }), USER)).toBeNull();
  });
});
