import { describe, expect, test } from 'bun:test';
import { SimulatorService } from '../bot-engine/simulator.service';
import { ChatSettingsService } from '../bot-engine/chat-settings.service';
import { ModuleHandlerRegistry } from '../bot-engine/module-handler-registry';
import { BotI18nService } from '../bot-engine/bot-i18n.service';
import { AdminGateService } from '../bot-engine/admin-gate.service';
import { RestrictionsService } from '../bot-engine/restrictions.service';
import { StartMenuRuntime } from '../modules/start-menu/start-menu.runtime';
import { SupportRuntime } from '../modules/support/support.runtime';
import { RulesRuntime } from '../modules/rules/rules.runtime';
import { GroupToolsRuntime } from '../modules/group-tools/group-tools.runtime';
import { GroupModerationRuntime } from '../modules/group-moderation/group-moderation.runtime';
import { LocksRuntime } from '../modules/locks/locks.runtime';

describe('ChatSettingsService & SimulatorService module execution', () => {
  test('ChatSettingsService targets active chats by default and merges bot + chat configs', async () => {
    const botModules: Record<string, { enabled: boolean; configJson: string }> = {
      locks: {
        enabled: true,
        configJson: JSON.stringify({ lockTypes: ['url'], warnOnDelete: true }),
      },
    };
    const chatSettingsRows: Array<{
      botId: string;
      chatId: string;
      moduleKey: string;
      configJson: string;
    }> = [];

    const prismaStub = {
      botModule: {
        findUnique: async ({
          where,
        }: {
          where: { botId_moduleKey: { botId: string; moduleKey: string } };
        }) => {
          const row = botModules[where.botId_moduleKey.moduleKey];
          if (!row) return null;
          return {
            botId: where.botId_moduleKey.botId,
            moduleKey: where.botId_moduleKey.moduleKey,
            enabled: row.enabled,
            configJson: row.configJson,
          };
        },
      },
      chatModuleSetting: {
        findUnique: async ({
          where,
        }: {
          where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
        }) => {
          const { botId, chatId, moduleKey } = where.botId_chatId_moduleKey;
          return (
            chatSettingsRows.find(
              (r) => r.botId === botId && r.chatId === chatId && r.moduleKey === moduleKey,
            ) ?? null
          );
        },
        findFirst: async ({ where }: { where: { botId: string; moduleKey: string } }) =>
          chatSettingsRows.find(
            (r) => r.botId === where.botId && r.moduleKey === where.moduleKey,
          ) ?? null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
          create: {
            botId: string;
            chatId: string;
            moduleKey: string;
            configJson: string;
          };
          update: { configJson?: string };
        }) => {
          const idx = chatSettingsRows.findIndex(
            (r) =>
              r.botId === where.botId_chatId_moduleKey.botId &&
              r.chatId === where.botId_chatId_moduleKey.chatId &&
              r.moduleKey === where.botId_chatId_moduleKey.moduleKey,
          );
          if (idx >= 0) {
            chatSettingsRows[idx] = {
              ...chatSettingsRows[idx],
              ...(update.configJson !== undefined ? { configJson: update.configJson } : {}),
            };
            return chatSettingsRows[idx];
          }
          chatSettingsRows.push(create);
          return create;
        },
      },
    };

    const chatSettings = new ChatSettingsService(prismaStub as never);

    // Without any per-chat row, a chat-scoped module (e.g. locks) is NOT targeted by default:
    expect(await chatSettings.isTargeted('bot-1', -100555666, 'locks')).toBe(false);

    // Setting a per-chat override targets that chat and applies the custom config:
    await chatSettings.setOverride('bot-1', -100555666, 'locks', {
      lockTypes: ['url'],
      warnOnDelete: true,
      allowlist: [],
    });
    const effective = await chatSettings.getEffectiveConfig('bot-1', -100555666, 'locks');
    expect(effective.lockTypes).toEqual(['url']);
    expect(effective.warnOnDelete).toBe(true);
    expect(effective.allowlist).toEqual([]);
    expect(await chatSettings.isTargeted('bot-1', -100555666, 'locks')).toBe(true);

    // Explicitly disabling the module for a specific chat untargets that chat:
    await chatSettings.setOverride('bot-1', -100555666, 'locks', { enabled: false });
    expect(await chatSettings.isTargeted('bot-1', -100555666, 'locks')).toBe(false);
  });

  test('SimulatorService executes commands, DM auto-replies, moderation, and lock deletions', async () => {
    const botId = 'bot-sim-test';
    const enabledMap: Record<string, Record<string, unknown>> = {
      'start-menu': { startMessage: 'Welcome to Studio Bot!' },
      support: { adminChatId: 0, welcomeText: 'Support received your message.' },
      rules: { rulesText: '1. Be respectful' },
      'group-tools': {},
      'group-moderation': {},
      locks: { lockTypes: [], allowlist: [], warnOnDelete: false },
    };

    const chatOverrides = new Map<string, Record<string, unknown>>();

    const prismaStub = {
      bot: {
        findUnique: async () => ({ id: botId, name: 'TestBot' }),
      },
      botModule: {
        findMany: async () =>
          Object.entries(enabledMap).map(([key, cfg]) => ({
            botId,
            moduleKey: key,
            enabled: true,
            configJson: JSON.stringify(cfg),
          })),
        findUnique: async ({
          where,
        }: {
          where: { botId_moduleKey: { botId: string; moduleKey: string } };
        }) => {
          const cfg = enabledMap[where.botId_moduleKey.moduleKey];
          if (!cfg) return null;
          return {
            botId,
            moduleKey: where.botId_moduleKey.moduleKey,
            enabled: true,
            configJson: JSON.stringify(cfg),
          };
        },
      },
      chatModuleSetting: {
        findUnique: async ({
          where,
        }: {
          where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
        }) => {
          const k = `${where.botId_chatId_moduleKey.chatId}:${where.botId_chatId_moduleKey.moduleKey}`;
          const row = chatOverrides.get(k);
          if (!row) return null;
          return {
            botId,
            chatId: where.botId_chatId_moduleKey.chatId,
            moduleKey: where.botId_chatId_moduleKey.moduleKey,
            configJson: JSON.stringify(row),
          };
        },
        findFirst: async () => null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { botId_chatId_moduleKey: { botId: string; chatId: string; moduleKey: string } };
          create: { chatId: string; moduleKey: string; configJson: string };
          update: { configJson?: string };
        }) => {
          const k = `${where.botId_chatId_moduleKey.chatId}:${where.botId_chatId_moduleKey.moduleKey}`;
          const existing = chatOverrides.get(k);
          const nextConfig =
            update.configJson !== undefined
              ? (JSON.parse(update.configJson) as Record<string, unknown>)
              : existing
                ? existing
                : (JSON.parse(create.configJson) as Record<string, unknown>);
          chatOverrides.set(k, nextConfig);
          return {
            botId,
            chatId: where.botId_chatId_moduleKey.chatId,
            moduleKey: where.botId_chatId_moduleKey.moduleKey,
            configJson: JSON.stringify(nextConfig),
          };
        },
      },
      chatApproval: {
        findUnique: async () => null,
      },
    };

    const registry = new ModuleHandlerRegistry();
    const chatSettings = new ChatSettingsService(prismaStub as never);
    const i18n = new BotI18nService(prismaStub as never);
    const adminGate = new AdminGateService();
    const restrictions = new RestrictionsService();
    const adminLog = { emit: () => undefined };
    const upsertedUsers: number[] = [];
    const lastSupportReplies = new Map<number, number>();
    const helpers = {
      upsertUser: async (_botId: string, from: { id: number }) => {
        upsertedUsers.push(from.id);
      },
    };

    new StartMenuRuntime(
      {
        list: async () => [],
      } as never,
      registry,
    );
    new SupportRuntime(
      helpers as never,
      {
        createMessage: async () => undefined,
        findTopicId: async () => null,
        saveTopicId: async () => undefined,
        findUserIdByTopic: async () => null,
        getLastAutoReplyAt: async (_botId: string, userId: number) =>
          lastSupportReplies.get(userId) ?? null,
        setLastAutoReplyAt: async (_botId: string, userId: number) => {
          lastSupportReplies.set(userId, Date.now());
        },
      } as never,
      {
        getBotSetting: () => null,
        setBotSetting: async () => undefined,
      } as never,
      registry,
    );
    new RulesRuntime(adminGate, i18n, chatSettings, adminLog as never, registry);
    new GroupToolsRuntime(
      adminGate,
      adminLog as never,
      i18n,
      chatSettings,
      { isDisabled: async () => false } as never,
      registry,
    );
    new GroupModerationRuntime(
      prismaStub as never,
      adminGate,
      restrictions,
      adminLog as never,
      i18n,
      chatSettings,
      registry,
    );
    new LocksRuntime(
      prismaStub as never,
      adminGate,
      restrictions,
      adminLog as never,
      i18n,
      chatSettings,
      registry,
    );

    const simulator = new SimulatorService(prismaStub as never, registry, helpers as never);

    // 1. /start in private chat triggers StartMenu (even with empty items) and upserts subscriber
    const startRes = await simulator.send(botId, { text: '/start', chatType: 'private' });
    expect(startRes.unmatched).toBe(false);
    expect(upsertedUsers.length).toBeGreaterThan(0);
    expect(startRes.text).toContain('Welcome to Studio Bot!');

    // 2. /rules works in private chat as well as supergroup
    const rulesRes = await simulator.send(botId, { text: '/rules', chatType: 'private' });
    expect(rulesRes.unmatched).toBe(false);
    expect(rulesRes.text).toContain('1. Be respectful');

    // 3. Plain private message triggers Support auto-reply even when adminChatId is 0
    const supportRes = await simulator.send(botId, {
      text: 'Hello support team',
      chatType: 'private',
    });
    expect(supportRes.unmatched).toBe(false);
    expect(supportRes.text).toContain('Support received your message.');

    // 4. /ban @spamuser 10m in supergroup resolves @username and bans member
    const banRes = await simulator.send(botId, {
      text: '/ban @spamuser 10m',
      chatType: 'supergroup',
    });
    expect(banRes.unmatched).toBe(false);
    expect(banRes.text.length).toBeGreaterThan(0);

    // 5. /lock url in supergroup updates lock types, and sending a link deletes the message
    const lockCmdRes = await simulator.send(botId, {
      text: '/lock url',
      chatType: 'supergroup',
    });
    expect(lockCmdRes.unmatched).toBe(false);

    const urlMsgRes = await simulator.send(botId, {
      text: 'check out https://spam.example now',
      chatType: 'supergroup',
    });
    expect(urlMsgRes.unmatched).toBe(false);
    expect(urlMsgRes.text).toContain('Message deleted');
  });
});
