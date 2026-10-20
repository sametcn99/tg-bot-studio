import { describe, expect, test } from 'bun:test';
import { ChatSettingsService } from '../bot-engine/chat-settings.service';
import { MODULE_REGISTRY } from '../bot-engine/module-registry';
import { SIMULATOR_GROUP_ID } from '../common/utils/chat-targets.util';

describe('Chat-scoped vs global modules targeting behavior', () => {
  const botId = 'test-bot-scoped';
  const arbitraryChatId = -100987654321;

  const chatSettingsStore = new Map<string, Record<string, unknown>>();

  const prismaStub = {
    botModule: {
      findUnique: async () => null,
      findMany: async () => [],
    },
    chatModuleSetting: {
      findUnique: async ({
        where,
      }: {
        where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
      }) => {
        const key = `${where.botId_chatId_moduleKey.botId}:${where.botId_chatId_moduleKey.chatId}:${where.botId_chatId_moduleKey.moduleKey}`;
        const data = chatSettingsStore.get(key);
        if (!data) return null;
        return {
          botId: where.botId_chatId_moduleKey.botId,
          chatId: where.botId_chatId_moduleKey.chatId,
          moduleKey: where.botId_chatId_moduleKey.moduleKey,
          configJson: JSON.stringify(data),
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

  const chatScopedModules = MODULE_REGISTRY.filter((m) => m.chatScoped === true);
  const nonChatScopedModules = MODULE_REGISTRY.filter((m) => !m.chatScoped);

  test('all 17 chatScoped modules are NOT targeted by default in an unconfigured chat', async () => {
    expect(chatScopedModules.length).toBe(17);

    for (const mod of chatScopedModules) {
      const isTargeted = await chatSettings.isTargeted(botId, arbitraryChatId, mod.key);
      expect(isTargeted).toBe(false);

      const effective = await chatSettings.getEffectiveConfig(botId, arbitraryChatId, mod.key);
      expect(effective.targetChats).toEqual([]);
    }
  });

  test('all chatScoped modules pass targeting in the sandbox simulator chat', async () => {
    for (const mod of chatScopedModules) {
      const isTargeted = await chatSettings.isTargeted(botId, SIMULATOR_GROUP_ID, mod.key);
      expect(isTargeted).toBe(true);
    }
  });

  test('chatScoped module becomes targeted when a per-chat configuration is saved', async () => {
    // Test with locks
    expect(await chatSettings.isTargeted(botId, arbitraryChatId, 'locks')).toBe(false);

    await chatSettings.setOverride(botId, arbitraryChatId, 'locks', {
      lockedTypes: ['stickers', 'urls'],
    });

    expect(await chatSettings.isTargeted(botId, arbitraryChatId, 'locks')).toBe(true);
    const config = await chatSettings.getEffectiveConfig(botId, arbitraryChatId, 'locks');
    expect(config.targetChats).toEqual([String(arbitraryChatId)]);
    expect(config.lockedTypes).toEqual(['stickers', 'urls']);

    // Disabling it untargets it
    await chatSettings.setOverride(botId, arbitraryChatId, 'locks', {
      enabled: false,
    });
    expect(await chatSettings.isTargeted(botId, arbitraryChatId, 'locks')).toBe(false);
  });

  test('non-chatScoped modules remain targeted across chats by default', async () => {
    expect(nonChatScopedModules.length).toBeGreaterThan(0);

    for (const mod of nonChatScopedModules) {
      const isTargeted = await chatSettings.isTargeted(botId, arbitraryChatId, mod.key);
      expect(isTargeted).toBe(true);
    }
  });
});
