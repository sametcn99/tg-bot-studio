import { describe, expect, test } from 'bun:test';
import { Bot } from 'grammy';
import { AutoresponderRuntime } from '../modules/autoresponder/autoresponder.runtime';
import {
  AutoresponderService,
  type AutoresponderRow,
} from '../modules/autoresponder/autoresponder.service';
import { AdminGateService } from '../bot-engine/admin-gate.service';
import { BotI18nService } from '../bot-engine/bot-i18n.service';
import { ModuleHandlerRegistry } from '../bot-engine/module-handler-registry';
import { GROUP_ANONYMOUS_BOT_ID, CHANNEL_BOT_ID } from '../common/utils/telegram-text.util';

describe('AutoresponderRuntime admin and member message execution', () => {
  const botId = 'bot-test-123';
  const rules: AutoresponderRow[] = [
    {
      id: 'rule-1',
      bot_id: botId,
      botId,
      command: '/ping',
      response_text: 'pong 🏓',
      responseText: 'pong 🏓',
      media_url: null,
      mediaUrl: null,
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 0,
      deletePreviousResponse: 0,
      reply_to_message: 0,
      replyToMessage: 0,
    },
    {
      id: 'rule-clean',
      bot_id: botId,
      botId,
      command: 'test',
      response_text: 'test response',
      responseText: 'test response',
      media_url: null,
      mediaUrl: null,
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 1,
      deletePreviousResponse: 1,
      reply_to_message: 0,
      replyToMessage: 0,
    },
    {
      id: 'rule-clean-cmd',
      bot_id: botId,
      botId,
      command: '/clean',
      response_text: 'clean command reply',
      responseText: 'clean command reply',
      media_url: null,
      mediaUrl: null,
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 1,
      deletePreviousResponse: 1,
      reply_to_message: 0,
      replyToMessage: 0,
    },
    {
      id: 'rule-admin',
      bot_id: botId,
      botId,
      command: '/adminonly',
      response_text: 'secret admin reply',
      responseText: 'secret admin reply',
      media_url: null,
      mediaUrl: null,
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 1,
      adminOnly: 1,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 0,
      deletePreviousResponse: 0,
      reply_to_message: 0,
      replyToMessage: 0,
    },
    {
      id: 'rule-reply',
      bot_id: botId,
      botId,
      command: '/replyme',
      response_text: 'replying directly to you!',
      responseText: 'replying directly to you!',
      media_url: null,
      mediaUrl: null,
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 0,
      deletePreviousResponse: 0,
      reply_to_message: 1,
      replyToMessage: 1,
    },
    {
      id: 'rule-photo-reply',
      bot_id: botId,
      botId,
      command: '/photoreply',
      response_text: 'photo reply caption',
      responseText: 'photo reply caption',
      media_url: 'https://example.com/photo.jpg',
      mediaUrl: 'https://example.com/photo.jpg',
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 0,
      deletePreviousResponse: 0,
      reply_to_message: 1,
      replyToMessage: 1,
    },
    {
      id: 'rule-upload-photo',
      bot_id: botId,
      botId,
      command: '/uploadphoto',
      response_text: 'uploaded photo caption',
      responseText: 'uploaded photo caption',
      media_url: null,
      mediaUrl: null,
      media_data: Buffer.from('fake-png-bytes'),
      mediaData: Buffer.from('fake-png-bytes'),
      media_mime: 'image/png',
      mediaMime: 'image/png',
      media_file_name: 'test.png',
      mediaFileName: 'test.png',
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 0,
      deletePreviousResponse: 0,
      reply_to_message: 0,
      replyToMessage: 0,
    },
    {
      id: 'rule-video',
      bot_id: botId,
      botId,
      command: '/videoreply',
      response_text: 'video caption',
      responseText: 'video caption',
      media_url: 'https://example.com/demo.mp4',
      mediaUrl: 'https://example.com/demo.mp4',
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 0,
      deletePreviousResponse: 0,
      reply_to_message: 0,
      replyToMessage: 0,
    },
    {
      id: 'rule-anim',
      bot_id: botId,
      botId,
      command: '/animreply',
      response_text: 'anim caption',
      responseText: 'anim caption',
      media_url: 'https://example.com/demo.gif',
      mediaUrl: 'https://example.com/demo.gif',
      buttons_json: null,
      buttonsJson: null,
      is_active: 1,
      isActive: 1,
      chat_id: null,
      chatId: null,
      scope: 'all',
      match_mode: 'keyword',
      matchMode: 'keyword',
      admin_only: 0,
      adminOnly: 0,
      repeat_seconds: 0,
      repeatSeconds: 0,
      delete_previous_response: 0,
      deletePreviousResponse: 0,
      reply_to_message: 0,
      replyToMessage: 0,
    },
  ];

  const fakeService = {
    list: async () => rules,
  } as unknown as AutoresponderService;

  const fakeBotModel = {
    getModule: async () => null,
  };

  const adminGate = new AdminGateService();
  const fakeI18n = {} as BotI18nService;
  const registry = new ModuleHandlerRegistry();

  const runtime = new AutoresponderRuntime(
    fakeService,
    fakeBotModel as never,
    adminGate,
    fakeI18n,
    registry,
  );

  function createTestBot() {
    const bot = new Bot('0:test');
    bot.botInfo = {
      id: 42,
      is_bot: true,
      first_name: 'StudioBot',
      username: 'studio_bot',
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
    } as never;

    const replies: Array<{
      method: string;
      text?: string;
      messageId?: number;
      payload?: Record<string, unknown>;
    }> = [];
    const deletions: Array<{ method: string; chatId: number | string; messageId: number }> = [];
    let messageSeq = 100;
    bot.api.config.use((_prev, method, payload) => {
      if (method === 'sendMessage') {
        const msgId = ++messageSeq;
        replies.push({
          method,
          text: (payload as { text?: string }).text,
          messageId: msgId,
          payload: payload as Record<string, unknown>,
        });
        return Promise.resolve({
          ok: true,
          result: {
            message_id: msgId,
            date: 0,
            chat: { id: (payload as { chat_id?: number }).chat_id ?? -1001234567 },
          } as never,
        });
      }
      if (method === 'sendPhoto') {
        const msgId = ++messageSeq;
        replies.push({
          method,
          text: (payload as { caption?: string }).caption,
          messageId: msgId,
          payload: payload as Record<string, unknown>,
        });
        return Promise.resolve({
          ok: true,
          result: {
            message_id: msgId,
            date: 0,
            chat: { id: (payload as { chat_id?: number }).chat_id ?? -1001234567 },
          } as never,
        });
      }
      if (method === 'sendVideo' || method === 'sendAnimation') {
        const msgId = ++messageSeq;
        replies.push({
          method,
          text: (payload as { caption?: string }).caption,
          messageId: msgId,
          payload: payload as Record<string, unknown>,
        });
        return Promise.resolve({
          ok: true,
          result: {
            message_id: msgId,
            date: 0,
            chat: { id: (payload as { chat_id?: number }).chat_id ?? -1001234567 },
          } as never,
        });
      }
      if (method === 'deleteMessage') {
        deletions.push({
          method,
          chatId: (payload as { chat_id?: number | string }).chat_id ?? '',
          messageId: (payload as { message_id?: number }).message_id ?? 0,
        });
        return Promise.resolve({ ok: true, result: true as never });
      }
      if (method === 'getChatAdministrators') {
        return Promise.resolve({
          ok: true,
          result: [
            {
              status: 'administrator',
              user: { id: 99999, is_bot: false, first_name: 'AdminUser' },
              can_manage_chat: true,
            },
          ] as never,
        });
      }
      return Promise.resolve({
        ok: true,
        result: { message_id: 1, date: 0, chat: { id: -1001234567 } } as never,
      });
    });

    runtime.register({ bot, botId, config: {} });
    return { bot, replies, deletions };
  }

  test('responds to regular group members on commands', async () => {
    const { bot, replies } = createTestBot();

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/ping',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('pong 🏓');
  });

  test('responds to anonymous group admins (GroupAnonymousBot with is_bot: true)', async () => {
    const { bot, replies } = createTestBot();

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        from: {
          id: GROUP_ANONYMOUS_BOT_ID,
          is_bot: true,
          first_name: 'Group',
          username: 'GroupAnonymousBot',
        },
        sender_chat: { id: -1001234567, title: 'Community Group', type: 'supergroup' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/ping',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('pong 🏓');
  });

  test('responds to channel admins (Channel_Bot / sender_chat with is_bot: true)', async () => {
    const { bot, replies } = createTestBot();

    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 12,
        from: {
          id: CHANNEL_BOT_ID,
          is_bot: true,
          first_name: 'Telegram',
          username: 'Channel_Bot',
        },
        sender_chat: { id: -1009999999, title: 'Announcements Channel', type: 'channel' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/ping',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('pong 🏓');
  });

  test('ignores third-party spam bots in groups', async () => {
    const { bot, replies } = createTestBot();

    await bot.handleUpdate({
      update_id: 4,
      message: {
        message_id: 13,
        from: { id: 777888999, is_bot: true, first_name: 'SomeSpamBot', username: 'spambot' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/ping',
      },
    } as never);

    expect(replies.length).toBe(0);
  });

  test('admin-only rules respond to anonymous admins and stay silent for regular members', async () => {
    const { bot, replies } = createTestBot();

    // Regular member attempts admin-only rule -> ignored
    await bot.handleUpdate({
      update_id: 5,
      message: {
        message_id: 14,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/adminonly',
      },
    } as never);

    expect(replies.length).toBe(0);

    // Anonymous admin attempts admin-only rule -> succeeds
    await bot.handleUpdate({
      update_id: 6,
      message: {
        message_id: 15,
        from: {
          id: GROUP_ANONYMOUS_BOT_ID,
          is_bot: true,
          first_name: 'Group',
          username: 'GroupAnonymousBot',
        },
        sender_chat: { id: -1001234567, title: 'Community Group', type: 'supergroup' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/adminonly',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('secret admin reply');
  });

  test('does not delete previous response when delete_previous_response is off', async () => {
    const { bot, replies, deletions } = createTestBot();

    // First /ping
    await bot.handleUpdate({
      update_id: 10,
      message: {
        message_id: 20,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/ping',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('pong 🏓');
    expect(deletions.length).toBe(0);

    // Second /ping in the same chat
    await bot.handleUpdate({
      update_id: 11,
      message: {
        message_id: 21,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1005,
        text: '/ping',
      },
    } as never);

    expect(replies.length).toBe(2);
    expect(deletions.length).toBe(0);
  });

  test('deletes previous bot response when delete_previous_response is enabled on keyword trigger', async () => {
    const { bot, replies, deletions } = createTestBot();

    // First "test" message
    await bot.handleUpdate({
      update_id: 20,
      message: {
        message_id: 30,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1005555555, type: 'supergroup', title: 'Test Group' },
        date: 1000,
        text: 'hello test world',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('test response');
    const firstBotMsgId = replies[0]?.messageId;
    expect(firstBotMsgId).toBeDefined();
    expect(deletions.length).toBe(0);

    // Second "test" message arrives in the same chat -> bot should reply and delete the first response
    await bot.handleUpdate({
      update_id: 21,
      message: {
        message_id: 31,
        from: { id: 67890, is_bot: false, first_name: 'Bob' },
        chat: { id: -1005555555, type: 'supergroup', title: 'Test Group' },
        date: 1010,
        text: 'another test message',
      },
    } as never);

    expect(replies.length).toBe(2);
    expect(deletions.length).toBe(1);
    expect(Number(deletions[0]?.chatId)).toBe(-1005555555);
    expect(deletions[0]?.messageId).toBe(firstBotMsgId!);

    // Third "test" message -> deletes second response
    const secondBotMsgId = replies[1]?.messageId;
    await bot.handleUpdate({
      update_id: 22,
      message: {
        message_id: 32,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1005555555, type: 'supergroup', title: 'Test Group' },
        date: 1020,
        text: 'test',
      },
    } as never);

    expect(replies.length).toBe(3);
    expect(deletions.length).toBe(2);
    expect(deletions[1]?.messageId).toBe(secondBotMsgId!);
  });

  test('isolates previous response deletion by chat', async () => {
    const { bot, replies, deletions } = createTestBot();
    const chatA = -1001111111;
    const chatB = -1002222222;

    // Chat A triggers /clean
    await bot.handleUpdate({
      update_id: 30,
      message: {
        message_id: 40,
        from: { id: 101, is_bot: false, first_name: 'UserA' },
        chat: { id: chatA, type: 'supergroup', title: 'Group A' },
        date: 1000,
        text: '/clean',
      },
    } as never);

    expect(replies.length).toBe(1);
    const chatABotMsg1 = replies[0]?.messageId;
    expect(deletions.length).toBe(0);

    // Chat B triggers /clean -> Chat A's message must NOT be deleted
    await bot.handleUpdate({
      update_id: 31,
      message: {
        message_id: 41,
        from: { id: 102, is_bot: false, first_name: 'UserB' },
        chat: { id: chatB, type: 'supergroup', title: 'Group B' },
        date: 1005,
        text: '/clean',
      },
    } as never);

    expect(replies.length).toBe(2);
    const chatBBotMsg1 = replies[1]?.messageId;
    expect(deletions.length).toBe(0);

    // Chat A triggers /clean again -> deletes Chat A's previous message only
    await bot.handleUpdate({
      update_id: 32,
      message: {
        message_id: 42,
        from: { id: 101, is_bot: false, first_name: 'UserA' },
        chat: { id: chatA, type: 'supergroup', title: 'Group A' },
        date: 1010,
        text: '/clean',
      },
    } as never);

    expect(replies.length).toBe(3);
    expect(deletions.length).toBe(1);
    expect(Number(deletions[0]?.chatId)).toBe(chatA);
    expect(deletions[0]?.messageId).toBe(chatABotMsg1!);

    // Chat B triggers /clean again -> deletes Chat B's previous message only
    await bot.handleUpdate({
      update_id: 33,
      message: {
        message_id: 43,
        from: { id: 102, is_bot: false, first_name: 'UserB' },
        chat: { id: chatB, type: 'supergroup', title: 'Group B' },
        date: 1015,
        text: '/clean',
      },
    } as never);

    expect(replies.length).toBe(4);
    expect(deletions.length).toBe(2);
    expect(Number(deletions[1]?.chatId)).toBe(chatB);
    expect(deletions[1]?.messageId).toBe(chatBBotMsg1!);
  });

  test('includes reply_parameters when replyToMessage is enabled', async () => {
    const { bot, replies } = createTestBot();

    await bot.handleUpdate({
      update_id: 50,
      message: {
        message_id: 888,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/replyme',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('replying directly to you!');
    expect(replies[0]?.payload?.reply_parameters).toEqual({
      message_id: 888,
      allow_sending_without_reply: true,
    });
  });

  test('does not include reply_parameters when replyToMessage is disabled (0)', async () => {
    const { bot, replies } = createTestBot();

    await bot.handleUpdate({
      update_id: 51,
      message: {
        message_id: 889,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/ping',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.text).toBe('pong 🏓');
    expect(replies[0]?.payload?.reply_parameters).toBeUndefined();
  });

  test('includes reply_parameters for photo response when replyToMessage is enabled', async () => {
    const { bot, replies } = createTestBot();

    await bot.handleUpdate({
      update_id: 52,
      message: {
        message_id: 990,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/photoreply',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.method).toBe('sendPhoto');
    expect(replies[0]?.payload?.reply_parameters).toEqual({
      message_id: 990,
      allow_sending_without_reply: true,
    });
  });

  test('AutoresponderService saves and updates replyToMessage', async () => {
    let storedData: Record<string, unknown> = {};
    const mockModel = {
      create: async (data: Record<string, unknown>) => {
        storedData = { id: 'created-1', ...data };
        return storedData;
      },
      findById: async () => storedData,
      update: async (id: string, data: Record<string, unknown>) => {
        storedData = { ...storedData, ...data };
        return storedData;
      },
    };
    const svc = new AutoresponderService(mockModel as never);

    const created = await svc.create('bot-1', {
      command: '/testreply',
      responseText: 'hello',
      replyToMessage: true,
    });
    expect(created.replyToMessage).toBe(1);
    expect(created.reply_to_message).toBe(1);

    const updated = await svc.update('bot-1', 'created-1', {
      replyToMessage: false,
    });
    expect(updated.replyToMessage).toBe(0);
    expect(updated.reply_to_message).toBe(0);
  });

  test('AutoresponderRuntime sends native photo with InputFile when media_data is present', async () => {
    const { bot, replies } = createTestBot();
    await bot.handleUpdate({
      update_id: 10001,
      message: {
        message_id: 991,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/uploadphoto',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.method).toBe('sendPhoto');
    expect(replies[0]?.text).toBe('uploaded photo caption');
    expect(replies[0]?.payload?.photo).toBeDefined();
  });

  test('AutoresponderRuntime sends video when media_url has video extension', async () => {
    const { bot, replies } = createTestBot();
    await bot.handleUpdate({
      update_id: 10002,
      message: {
        message_id: 992,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/videoreply',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.method).toBe('sendVideo');
    expect(replies[0]?.text).toBe('video caption');
    expect(replies[0]?.payload?.video).toBe('https://example.com/demo.mp4');
  });

  test('AutoresponderRuntime sends animation when media_url has gif extension', async () => {
    const { bot, replies } = createTestBot();
    await bot.handleUpdate({
      update_id: 10003,
      message: {
        message_id: 993,
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        chat: { id: -1001234567, type: 'supergroup', title: 'Community Group' },
        date: 1000,
        text: '/animreply',
      },
    } as never);

    expect(replies.length).toBe(1);
    expect(replies[0]?.method).toBe('sendAnimation');
    expect(replies[0]?.text).toBe('anim caption');
    expect(replies[0]?.payload?.animation).toBe('https://example.com/demo.gif');
  });

  test('AutoresponderService saves uploaded media bytes, mime and file name, and getMediaFile serves them', async () => {
    let storedData: Record<string, unknown> = {};
    const mockModel = {
      create: async (data: Record<string, unknown>) => {
        storedData = { id: 'created-media-1', ...data };
        return storedData;
      },
      findById: async () => storedData,
      update: async (id: string, data: Record<string, unknown>) => {
        storedData = { ...storedData, ...data };
        return storedData;
      },
    };
    const svc = new AutoresponderService(mockModel as never);

    const b64DataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const created = await svc.create('bot-1', {
      command: '/testmedia',
      responseText: 'hello with media',
      mediaData: b64DataUrl,
      mediaFileName: 'pixel.png',
    });

    expect(created.media_mime).toBe('image/png');
    expect(created.media_file_name).toBe('pixel.png');
    expect(Buffer.isBuffer(created.media_data)).toBe(true);
    expect(created.media_url).toBe('/api/bots/bot-1/autoresponders/created-media-1/media');

    const mediaFile = await svc.getMediaFile('bot-1', 'created-media-1');
    expect(mediaFile).not.toBeNull();
    expect(mediaFile?.mime).toBe('image/png');
    expect(Buffer.isBuffer(mediaFile?.data)).toBe(true);
  });
});
