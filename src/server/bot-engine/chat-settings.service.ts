import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { findModule } from './module-registry';
import {
  isChatTargeted,
  normalizeChatTargets,
  SIMULATOR_GROUP_ID,
  SIMULATOR_TELEGRAM_ID,
} from '../common/utils/chat-targets.util';
import { safeJsonObjectParse } from '../common/utils/json.util';

/** Cache entry for effective per-chat config. */
interface CacheEntry {
  config: Record<string, unknown>;
  cachedAt: number;
}

/** How long an effective-config cache entry stays valid (ms). */
const CACHE_TTL_MS = 15_000;

/**
 * Per-chat module configuration layer. Effective config merges registry
 * `defaultConfig` <- bot-level `bot_modules.config_json` <- per-chat
 * `chat_module_settings.config_json`. Enabled modules operate in all chats
 * where the bot is active unless restricted via `targetChats` or disabled
 * for a specific chat.
 */
@Injectable()
export class ChatSettingsService {
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads the effective module config for one chat: registry defaults
   * merged under the bot's module config and that chat's own override entry.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<Record<string, unknown>>} Effective configuration.
   */
  async getEffectiveConfig(
    botId: string,
    chatId: string | number,
    moduleKey: string,
  ): Promise<Record<string, unknown>> {
    const key = `${botId}:${chatId}:${moduleKey}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.config;
    }

    const definition = findModule(moduleKey);
    const [botModule, exactChatSetting] = await Promise.all([
      this.prisma.botModule
        .findUnique({
          where: { botId_moduleKey: { botId, moduleKey } },
        })
        .catch(() => null),
      this.prisma.chatModuleSetting
        .findUnique({
          where: { botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey } },
        })
        .catch(() => null),
    ]);

    const isSimulatorChat =
      String(chatId) === String(SIMULATOR_GROUP_ID) ||
      String(chatId) === String(SIMULATOR_TELEGRAM_ID);
    const chatSetting =
      exactChatSetting ??
      (isSimulatorChat
        ? await this.prisma.chatModuleSetting
            .findFirst({ where: { botId, moduleKey } })
            .catch(() => null)
        : null);

    const botConfig = safeJsonObjectParse(
      botModule?.configJson,
      {},
      `chatSettings:bot:${botId}:${moduleKey}`,
    );
    const chatConfig = safeJsonObjectParse(
      chatSetting?.configJson,
      {},
      `chatSettings:chat:${botId}:${chatId}:${moduleKey}`,
    );

    const config: Record<string, unknown> = {
      ...(definition?.defaultConfig ?? {}),
      ...botConfig,
      ...chatConfig,
    };

    const explicitTargets = normalizeChatTargets(botConfig.targetChats);
    if (chatConfig.enabled === false || botConfig.enabled === false) {
      config.targetChats = [];
    } else if (exactChatSetting) {
      config.targetChats = [String(chatId)];
    } else if (explicitTargets.length > 0) {
      config.targetChats = explicitTargets;
    } else if (definition?.chatScoped) {
      config.targetChats = isSimulatorChat ? [String(chatId)] : [];
    } else {
      config.targetChats = [String(chatId)];
    }

    this.cache.set(key, { config, cachedAt: Date.now() });
    return config;
  }

  /**
   * Reads a single effective boolean-ish value for a chat.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @param {string} field - Config field name.
   * @returns {Promise<unknown>} Effective field value (undefined when unset).
   */
  async getValue(
    botId: string,
    chatId: string | number,
    moduleKey: string,
    field: string,
  ): Promise<unknown> {
    const config = await this.getEffectiveConfig(botId, chatId, moduleKey);
    return config[field];
  }

  /**
   * Evaluates whether a module is explicitly targeted at one chat: a
   * per-chat configuration entry must exist for it. No implicit default —
   * without an entry the module stays idle in that chat, so every
   * chat-operating module must have its targets configured (from Chat
   * Connections) to act.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id of the event.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<boolean>} True only when the chat has a config entry.
   */
  async isTargeted(botId: string, chatId: string | number, moduleKey: string): Promise<boolean> {
    const config = await this.getEffectiveConfig(botId, chatId, moduleKey);
    return isChatTargeted(config.targetChats, chatId);
  }

  /**
   * Reads the raw per-chat configuration entry for one module (no defaults
   * merged). A non-null result with keys means the chat is targeted.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<Record<string, unknown> | null>} Entry fields or null.
   */
  async getOverride(
    botId: string,
    chatId: string | number,
    moduleKey: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.chatModuleSetting.findUnique({
      where: { botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey } },
    });
    return row?.configJson
      ? safeJsonObjectParse<Record<string, unknown>>(row.configJson, {}, 'chat-settings:override')
      : null;
  }

  /**
   * Saves (or replaces) one chat's configuration entry and refreshes the
   * cache. The stored entry is the chat's full module configuration —
   * creating it targets the module at the chat.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @param {Record<string, unknown>} config - Configuration fields to persist.
   * @returns {Promise<void>} Resolves once stored.
   */
  async setOverride(
    botId: string,
    chatId: string | number,
    moduleKey: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.chatModuleSetting.upsert({
      where: {
        botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey },
      },
      create: {
        botId,
        chatId: String(chatId),
        moduleKey,
        configJson: JSON.stringify(config),
      },
      update: { configJson: JSON.stringify(config) },
    });
    this.invalidate(botId, chatId, moduleKey);
  }

  /**
   * Removes one chat's configuration entry, untargeting the module there
   * (registry defaults alone leave it idle in that chat).
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<void>} Resolves once deleted (no-op when absent).
   */
  async clearOverride(botId: string, chatId: string | number, moduleKey: string): Promise<void> {
    await this.prisma.chatModuleSetting
      .delete({
        where: { botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey } },
      })
      .catch(() => undefined);
    this.invalidate(botId, chatId, moduleKey);
  }

  /**
   * Drops cache entries for a scope. Passing no arguments flushes everything
   * (used on bot restart).
   *
   * @param {number} [botId] - Studio bot id filter.
   * @param {string | number} [chatId] - Chat id filter.
   * @param {string} [moduleKey] - Module key filter.
   * @returns {void}
   */
  invalidate(botId?: string, chatId?: string | number, moduleKey?: string): void {
    for (const key of this.cache.keys()) {
      const [keyBot, keyChat, keyModule] = key.split(':');
      if (botId !== undefined && keyBot !== String(botId)) continue;
      if (chatId !== undefined && keyChat !== String(chatId)) continue;
      if (moduleKey !== undefined && keyModule !== moduleKey) continue;
      this.cache.delete(key);
    }
  }
}
