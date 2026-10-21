import { describe, expect, test } from 'bun:test';
import { Bot } from 'grammy';
import { WelcomeRuntime } from '../modules/welcome/welcome.runtime';
import { ChatSettingsService } from '../bot-engine/chat-settings.service';
import { AdminGateService } from '../bot-engine/admin-gate.service';
import { ModuleHandlerRegistry } from '../bot-engine/module-handler-registry';
import { SIMULATOR_GROUP_ID } from '../common/utils/chat-targets.util';

describe('Welcome and Farewell per-chat targeting and runtime behavior', () => {
  const botId = 'bot-welcome-test';
  const targetedChatId = -100111222333;
  const untargetedChatId = -100999888777;

  // In-memory chat module settings store
  const chatSettingsStore = new Map<string, Record<string, unknown>>();
  const fullTargetedConfig: Record<string, unknown> = {
    welcomeEnabled: true,
    template: 'Hello {mention} in {group_name}!',
    goodbyeEnabled: true,
    goodbyeText: 'Bye {first_name}!',
    deleteServiceMessages: true,
    deleteLeaveMessages: true,
  };
  chatSettingsStore.set(`${botId}:${targetedChatId}:welcome`, { ...fullTargetedConfig });

  /** Restores the targeted chat's full config (tests mutate the store). */
  function resetTargetedConfig(overrides: Record<string, unknown> = {}): void {
    chatSettingsStore.set(`${botId}:${targetedChatId}:welcome`, {
      ...fullTargetedConfig,
      ...overrides,
    });
    chatSettings.invalidate(botId, targetedChatId, 'welcome');
  }

  const prismaStub = {
    botModule: {
      findUnique: async ({
        where,
      }: {
        where: { botId_moduleKey: { botId: string; moduleKey: string } };
      }) => {
        return {
          botId: where.botId_moduleKey.botId,
          moduleKey: where.botId_moduleKey.moduleKey,
          isEnabled: 1,
          configJson: '{}',
        };
      },
    },
    chatModuleSetting: {
      findUnique: async ({
        where,
      }: {
        where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
      }) => {
        const key = `${where.botId_chatId_moduleKey.botId}:${where.botId_chatId_moduleKey.chatId}:${where.botId_chatId_moduleKey.moduleKey}`;
        const cfg = chatSettingsStore.get(key);
        if (!cfg) return null;
        return {
          botId: where.botId_chatId_moduleKey.botId,
          chatId: where.botId_chatId_moduleKey.chatId,
          moduleKey: where.botId_chatId_moduleKey.moduleKey,
          configJson: JSON.stringify(cfg),
        };
      },
      findFirst: async () => null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
        create: { botId: string; chatId: string; moduleKey: string; configJson: string };
        update: { configJson: string };
      }) => {
        const key = `${where.botId_chatId_moduleKey.botId}:${where.botId_chatId_moduleKey.chatId}:${where.botId_chatId_moduleKey.moduleKey}`;
        const json = update?.configJson ?? create.configJson;
        chatSettingsStore.set(key, JSON.parse(json));
      },
      delete: async ({
        where,
      }: {
        where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
      }) => {
        const key = `${where.botId_chatId_moduleKey.botId}:${where.botId_chatId_moduleKey.chatId}:${where.botId_chatId_moduleKey.moduleKey}`;
        chatSettingsStore.delete(key);
      },
    },
  };

  const chatSettings = new ChatSettingsService(prismaStub as never);
  const adminGate = new AdminGateService();
  const registry = new ModuleHandlerRegistry();
  const runtime = new WelcomeRuntime(adminGate, chatSettings, registry);

  test('welcome module is NOT targeted in chats without an explicit per-chat configuration', async () => {
    // Untargeted chat has no row in chatModuleSetting
    const isTargeted = await chatSettings.isTargeted(botId, untargetedChatId, 'welcome');
    expect(isTargeted).toBe(false);

    const config = await chatSettings.getEffectiveConfig(botId, untargetedChatId, 'welcome');
    expect(config.targetChats).toEqual([]);
  });

  test('welcome module IS targeted in chats with an explicit per-chat configuration', async () => {
    const isTargeted = await chatSettings.isTargeted(botId, targetedChatId, 'welcome');
    expect(isTargeted).toBe(true);

    const config = await chatSettings.getEffectiveConfig(botId, targetedChatId, 'welcome');
    expect(config.targetChats).toEqual([String(targetedChatId)]);
    expect(config.welcomeEnabled).toBe(true);
  });

  test('welcome module passes in simulator chat for studio sandbox testing', async () => {
    const isTargeted = await chatSettings.isTargeted(botId, SIMULATOR_GROUP_ID, 'welcome');
    expect(isTargeted).toBe(true);
  });

  test('chat-scoped modules (e.g. locks) are NOT targeted across group chats by default', async () => {
    const isTargeted = await chatSettings.isTargeted(botId, untargetedChatId, 'locks');
    expect(isTargeted).toBe(false);
  });

  test('non-chat-scoped modules (e.g. start-menu) remain targeted by default', async () => {
    const isTargeted = await chatSettings.isTargeted(botId, untargetedChatId, 'start-menu');
    expect(isTargeted).toBe(true);
  });

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

    const sentMessages: Array<{ chatId: number; text: string }> = [];
    const deletedMessages: Array<{ chatId: number; messageId: number }> = [];

    bot.api.config.use((_prev, method, payload) => {
      if (method === 'sendMessage') {
        const p = payload as { chat_id: number; text: string };
        sentMessages.push({ chatId: p.chat_id, text: p.text });
        return Promise.resolve({
          ok: true,
          result: {
            message_id: 100 + sentMessages.length,
            date: 0,
            chat: { id: p.chat_id },
          } as never,
        });
      }
      if (method === 'deleteMessage') {
        const p = payload as { chat_id: number; message_id: number };
        deletedMessages.push({ chatId: p.chat_id, messageId: p.message_id });
        return Promise.resolve({ ok: true, result: true as never });
      }
      if (method === 'getChatAdministrators') {
        return Promise.resolve({
          ok: true,
          result: [
            {
              status: 'administrator',
              user: { id: 99999, is_bot: false, first_name: 'AdminUser' },
              can_change_info: true,
            },
          ] as never,
        });
      }
      return Promise.resolve({
        ok: true,
        result: { message_id: 1, date: 0, chat: { id: targetedChatId } } as never,
      });
    });

    runtime.register({ bot, botId, config: {} });
    return { bot, sentMessages, deletedMessages };
  }

  /** Builds a chat_member status-change update. */
  function chatMemberUpdate(
    userId: number,
    firstName: string,
    oldStatus: string,
    newStatus: string,
    extraNew: Record<string, unknown> = {},
    chatId: number = targetedChatId,
    title = 'Targeted Community',
  ) {
    const user = { id: userId, is_bot: false, first_name: firstName };
    return {
      update_id: Date.now() % 1_000_000,
      chat_member: {
        chat: { id: chatId, type: 'supergroup', title },
        from: user,
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { user, status: oldStatus },
        new_chat_member: { user, status: newStatus, ...extraNew },
      },
    } as never;
  }

  test('new member in untargeted chat does NOT receive greeting and service message is NOT deleted', async () => {
    const { bot, sentMessages, deletedMessages } = createTestBot();

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 50,
        date: Math.floor(Date.now() / 1000),
        chat: { id: untargetedChatId, type: 'supergroup', title: 'Untargeted Community' },
        new_chat_members: [{ id: 12345, is_bot: false, first_name: 'Alice', username: 'alice' }],
      } as never,
    });

    expect(sentMessages.length).toBe(0);
    expect(deletedMessages.length).toBe(0);
  });

  test('new member in targeted chat receives greeting and service message is deleted', async () => {
    const { bot, sentMessages, deletedMessages } = createTestBot();

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 51,
        date: Math.floor(Date.now() / 1000),
        chat: { id: targetedChatId, type: 'supergroup', title: 'Targeted Community' },
        new_chat_members: [{ id: 20001, is_bot: false, first_name: 'Alice', username: 'alice' }],
      } as never,
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].chatId).toBe(targetedChatId);
    expect(sentMessages[0].text).toContain('@alice');
    expect(sentMessages[0].text).toContain('Targeted Community');

    // Join service message was deleted
    expect(deletedMessages.length).toBe(1);
    expect(deletedMessages[0].messageId).toBe(51);
  });

  test('left member in untargeted chat does NOT trigger goodbye', async () => {
    const { bot, sentMessages } = createTestBot();

    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 52,
        date: Math.floor(Date.now() / 1000),
        chat: { id: untargetedChatId, type: 'supergroup', title: 'Untargeted Community' },
        left_chat_member: { id: 20002, is_bot: false, first_name: 'Alice' },
      } as never,
    });

    expect(sentMessages.length).toBe(0);
  });

  test('left member in targeted chat triggers goodbye message and deletes service message', async () => {
    const { bot, sentMessages, deletedMessages } = createTestBot();

    await bot.handleUpdate({
      update_id: 4,
      message: {
        message_id: 53,
        date: Math.floor(Date.now() / 1000),
        chat: { id: targetedChatId, type: 'supergroup', title: 'Targeted Community' },
        left_chat_member: { id: 20003, is_bot: false, first_name: 'Alice' },
      } as never,
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain('Bye Alice!');
    expect(deletedMessages.some((d) => d.messageId === 53)).toBe(true);
  });

  test('welcomeEnabled: false suppresses greeting in targeted chat', async () => {
    resetTargetedConfig({ welcomeEnabled: false });

    const { bot, sentMessages, deletedMessages } = createTestBot();

    await bot.handleUpdate({
      update_id: 5,
      message: {
        message_id: 54,
        date: Math.floor(Date.now() / 1000),
        chat: { id: targetedChatId, type: 'supergroup', title: 'Targeted Community' },
        new_chat_members: [{ id: 20004, is_bot: false, first_name: 'Alice' }],
      } as never,
    });

    expect(sentMessages.length).toBe(0);
    // Service message still deleted if deleteServiceMessages: true
    expect(deletedMessages.length).toBe(1);

    resetTargetedConfig();
  });

  test('chat_member join (hidden service messages) greets the new member', async () => {
    const { bot, sentMessages } = createTestBot();

    await bot.handleUpdate(chatMemberUpdate(30001, 'Bob', 'left', 'member'));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].chatId).toBe(targetedChatId);
    expect(sentMessages[0].text).toContain('Bob');
    expect(sentMessages[0].text).toContain('Targeted Community');
  });

  test('chat_member join in untargeted chat does NOT greet', async () => {
    const { bot, sentMessages } = createTestBot();

    await bot.handleUpdate(
      chatMemberUpdate(
        30002,
        'Bob',
        'left',
        'member',
        {},
        untargetedChatId,
        'Untargeted Community',
      ),
    );

    expect(sentMessages.length).toBe(0);
  });

  test('chat_member promotion (member -> administrator) does NOT greet again', async () => {
    const { bot, sentMessages } = createTestBot();

    await bot.handleUpdate(chatMemberUpdate(30003, 'Bob', 'member', 'administrator'));

    expect(sentMessages.length).toBe(0);
  });

  test('chat_member kick triggers goodbye', async () => {
    const { bot, sentMessages } = createTestBot();

    await bot.handleUpdate(chatMemberUpdate(30004, 'Carl', 'member', 'kicked'));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain('Bye Carl!');
  });

  test('chat_member restricted removal (is_member false) triggers goodbye', async () => {
    const { bot, sentMessages } = createTestBot();

    await bot.handleUpdate(
      chatMemberUpdate(30005, 'Dana', 'member', 'restricted', { is_member: false }),
    );

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain('Bye Dana!');
  });

  test('join delivered as BOTH service message and chat_member greets exactly once', async () => {
    const { bot, sentMessages } = createTestBot();

    await bot.handleUpdate({
      update_id: 6,
      message: {
        message_id: 60,
        date: Math.floor(Date.now() / 1000),
        chat: { id: targetedChatId, type: 'supergroup', title: 'Targeted Community' },
        new_chat_members: [{ id: 30006, is_bot: false, first_name: 'Dora', username: 'dora' }],
      } as never,
    });
    await bot.handleUpdate(chatMemberUpdate(30006, 'Dora', 'left', 'member'));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain('@dora');
  });

  test('invalid HTML template falls back to plain text and still greets', async () => {
    resetTargetedConfig({ template: 'Hey {mention} 5 < 3!' });

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

    const sentMessages: Array<{ text: string; parseMode: unknown }> = [];
    bot.api.config.use((_prev, method, payload) => {
      if (method === 'sendMessage') {
        const p = payload as { text: string; parse_mode?: string };
        if (p.parse_mode === 'HTML') {
          // Telegram rejects unmatched "<" in HTML parse mode.
          return Promise.reject(new Error("Bad Request: can't parse entities"));
        }
        sentMessages.push({ text: p.text, parseMode: p.parse_mode });
        return Promise.resolve({
          ok: true,
          result: { message_id: 200, date: 0, chat: { id: targetedChatId } } as never,
        });
      }
      return Promise.resolve({
        ok: true,
        result: { message_id: 1, date: 0, chat: { id: targetedChatId } } as never,
      });
    });

    runtime.register({ bot, botId, config: {} });

    await bot.handleUpdate({
      update_id: 7,
      message: {
        message_id: 61,
        date: Math.floor(Date.now() / 1000),
        chat: { id: targetedChatId, type: 'supergroup', title: 'Targeted Community' },
        new_chat_members: [{ id: 30007, is_bot: false, first_name: 'Eve' }],
      } as never,
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].parseMode).toBeUndefined();
    expect(sentMessages[0].text).toContain('Hey Eve');
    expect(sentMessages[0].text).toContain('5 < 3');
    expect(sentMessages[0].text).not.toContain('<a');

    resetTargetedConfig();
  });
});
