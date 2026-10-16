import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

/**
 * One captured Telegram API call from the fake bot.
 */
export interface RecordedCall {
  method: string;
  payload: Record<string, unknown>;
}

/**
 * Builds a grammY Bot that never touches the network: every API call is
 * captured and answered with an OK envelope. Extracted from the sandbox
 * simulator's transformer (the production code path that already proved the
 * pattern) so runtime modules can be integration-tested.
 *
 * @param {string} [token] - Dummy token (never used for requests).
 * @param {Partial<UserFromGetMe>} [overrides] - botInfo overrides.
 * @returns {{bot: Bot; calls: RecordedCall[]}} Bot plus the captured-call log.
 */
export function createFakeBot(
  token = '123456:TEST-TOKEN',
  overrides: Partial<UserFromGetMe> = {},
): { bot: Bot; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const bot = new Bot(token);
  bot.botInfo = {
    id: 42,
    is_bot: true,
    first_name: 'TestBot',
    username: 'test_bot',
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
    ...overrides,
  } as UserFromGetMe;
  bot.catch(() => undefined);
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
    return Promise.resolve({ ok: true, result: true as never });
  });
  return { bot, calls };
}
