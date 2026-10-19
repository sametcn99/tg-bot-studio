import { describe, expect, test } from 'bun:test';
import type { Message, Update, User } from 'grammy/types';
import { FileSearchRuntime } from '../modules/file-search/file-search.runtime';
import { FileSearchService } from '../modules/file-search/file-search.service';
import type { ChatSettingsService } from '../bot-engine/chat-settings.service';
import type { BotI18nService } from '../bot-engine/bot-i18n.service';
import type { AdminLogService } from '../bot-engine/admin-log.service';
import type { ModuleHandlerRegistry } from '../bot-engine/module-handler-registry';
import { createFakeBot } from './helpers/fake-bot';

/** Default effective config the stub chat-settings layer hands out. */
const BASE_CONFIG = {
  builtInTriggers: true,
  extraTriggerPatterns: [],
  matchMode: 'all',
  includeCaptions: true,
  minQueryLength: 3,
  maxResults: 5,
  userCooldownSeconds: 30,
  chatCooldownSeconds: 10,
  noResultReply: false,
  fallbackCopy: true,
};

const SUPERGROUP = -100123456789;
const BASIC_GROUP = -987654321;

/** In-memory stand-in for the Prisma-backed index model. */
function fakeIndexModel() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    indexMessage: async (data: Record<string, unknown>) => {
      rows.push(data);
      return data;
    },
    listForChat: async (_botId: string, chatId: string) =>
      rows
        .filter((row) => row.chatId === chatId)
        .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt))),
  };
}

/**
 * Builds a runtime wired to in-memory fakes: real service cooldowns, a
 * canned chat-settings layer, and a key-style i18n stub.
 */
function buildRuntime() {
  const indexModel = fakeIndexModel();
  const service = new FileSearchService(
    indexModel as never,
    { findById: async () => ({ id: 'bot-1' }) } as never,
    { emit: () => undefined } as never,
  );
  const chatSettings = {
    getEffectiveConfig: async (_botId: string, chatId: string | number) => ({
      ...BASE_CONFIG,
      targetChats: [String(chatId)],
    }),
    isTargeted: async () => true,
  } as unknown as ChatSettingsService;
  const i18n = {
    getChatLanguage: async () => 'tr',
    t: (_lang: string, key: string, params?: Record<string, unknown>) =>
      `${key}:${Object.values(params ?? {}).join('/')}`,
  } as unknown as BotI18nService;
  const adminLog = { emit: () => undefined } as unknown as AdminLogService;
  const registry = { register: () => undefined } as unknown as ModuleHandlerRegistry;
  const runtime = new FileSearchRuntime(service, chatSettings, i18n, adminLog, registry);
  return { indexModel, service, runtime };
}

/** Telegram update factory for group messages. */
function messageUpdate(msg: Partial<Message>, chatId: number, messageId: number): Update {
  const text = typeof msg.text === 'string' ? msg.text : undefined;
  const message = {
    message_id: messageId,
    date: 1_700_000_000,
    chat: {
      id: chatId,
      type: chatId < 0 && String(chatId).startsWith('-100') ? 'supergroup' : 'group',
    },
    // grammY's command filter keys off the bot_command entity.
    ...(text?.startsWith('/')
      ? {
          text,
          entities: [
            {
              offset: 0,
              length: text.indexOf(' ') > 0 ? text.indexOf(' ') : text.length,
              type: 'bot_command',
            },
          ],
        }
      : {}),
    ...msg,
  };
  return { update_id: messageId, message } as unknown as Update;
}

const ALI: User = { id: 7, is_bot: false, first_name: 'Ali' };

describe('file-search runtime', () => {
  test('indexes shared documents and answers questions with links + mention', async () => {
    const { bot, calls } = createFakeBot();
    const { indexModel, runtime } = buildRuntime();
    let chainContinued = false;
    bot.use((_ctx, next) => {
      chainContinued = true;
      return next();
    });
    runtime.register({ bot, botId: 'bot-1', config: {} });

    await bot.handleUpdate(
      messageUpdate(
        {
          from: ALI,
          document: {
            file_id: 'f1',
            file_unique_id: 'u1',
            file_name: 'Staj Başvuru Formu.pdf',
            file_size: 1024,
          },
        },
        SUPERGROUP,
        50,
      ),
    );
    expect(indexModel.rows).toHaveLength(1);
    expect(indexModel.rows[0]).toMatchObject({
      chatId: String(SUPERGROUP),
      messageId: 50,
      kind: 'document',
      searchText: 'staj basvuru formu.pdf',
    });

    await bot.handleUpdate(messageUpdate({ from: ALI, text: 'staj formu var mı' }, SUPERGROUP, 51));
    const sent = calls.filter((call) => call.method === 'sendMessage');
    expect(sent).toHaveLength(1);
    const payload = sent[0].payload as Record<string, unknown>;
    expect(payload.chat_id).toBe(SUPERGROUP);
    expect(String(payload.text)).toContain('https://t.me/c/123456789/50');
    expect(String(payload.text)).toContain('tg://user?id=7');
    expect(payload.parse_mode).toBe('HTML');
    expect(payload.reply_parameters).toMatchObject({ message_id: 51 });
    // The middleware chain continues past the module.
    expect(chainContinued).toBe(true);
  });

  test('chat cooldown suppresses an immediate follow-up question', async () => {
    const { bot, calls } = createFakeBot();
    const { runtime } = buildRuntime();
    runtime.register({ bot, botId: 'bot-1', config: {} });

    await bot.handleUpdate(messageUpdate({ from: ALI, text: 'staj formu var mı' }, SUPERGROUP, 61));
    const first = calls.filter((call) => call.method === 'sendMessage').length;
    expect(first).toBe(0); // nothing indexed → silent by default

    const veli: User = { id: 8, is_bot: false, first_name: 'Veli' };
    await bot.handleUpdate(
      messageUpdate(
        {
          from: veli,
          document: { file_id: 'f2', file_unique_id: 'u2', file_name: 'Staj Formu.docx' },
        },
        SUPERGROUP,
        62,
      ),
    );
    await bot.handleUpdate(messageUpdate({ from: veli, text: 'form var mı' }, SUPERGROUP, 63));
    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1);
    await bot.handleUpdate(messageUpdate({ from: ALI, text: 'staj formu var mı' }, SUPERGROUP, 64));
    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1);
  });

  test('basic groups fall back to copyMessage instead of links', async () => {
    const { bot, calls } = createFakeBot();
    const { runtime } = buildRuntime();
    runtime.register({ bot, botId: 'bot-1', config: {} });

    await bot.handleUpdate(
      messageUpdate(
        { from: ALI, document: { file_id: 'f3', file_unique_id: 'u3', file_name: 'Sunum.pptx' } },
        BASIC_GROUP,
        70,
      ),
    );
    await bot.handleUpdate(messageUpdate({ from: ALI, text: 'sunum var mı' }, BASIC_GROUP, 71));

    const copies = calls.filter((call) => call.method === 'copyMessage');
    expect(copies).toHaveLength(1);
    expect(copies[0].payload).toMatchObject({
      chat_id: BASIC_GROUP,
      from_chat_id: BASIC_GROUP,
      message_id: 70,
      reply_parameters: { message_id: 71 },
    });
    const sent = calls.filter((call) => call.method === 'sendMessage');
    expect(sent).toHaveLength(1);
    expect(String(sent[0].payload.text)).not.toContain('https://t.me/c/');
  });

  test('/ara searches on demand and replies "not found" without a match', async () => {
    const { bot, calls } = createFakeBot();
    const { runtime } = buildRuntime();
    runtime.register({ bot, botId: 'bot-1', config: {} });

    await bot.handleUpdate(messageUpdate({ from: ALI, text: '/ara bulunmayan' }, SUPERGROUP, 80));
    const sent = calls.filter((call) => call.method === 'sendMessage');
    expect(sent).toHaveLength(1);
    expect(String(sent[0].payload.text)).toContain('fileSearch.noResult');
    expect(String(sent[0].payload.text)).toContain('tg://user?id=7');

    await bot.handleUpdate(messageUpdate({ from: ALI, text: '/ara ab' }, SUPERGROUP, 81));
    const tooShort = calls.filter((call) => call.method === 'sendMessage');
    expect(tooShort).toHaveLength(2);
    expect(String(tooShort[1].payload.text)).toContain('fileSearch.tooShort');
  });

  test('ignores bot senders and non-targeted-looking service messages', async () => {
    const { bot, calls } = createFakeBot();
    const { indexModel, runtime } = buildRuntime();
    runtime.register({ bot, botId: 'bot-1', config: {} });

    const botUser: User = { id: 999, is_bot: true, first_name: 'OtherBot' };
    await bot.handleUpdate(
      messageUpdate(
        { from: botUser, document: { file_id: 'f4', file_unique_id: 'u4', file_name: 'spam.pdf' } },
        SUPERGROUP,
        90,
      ),
    );
    expect(indexModel.rows).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
