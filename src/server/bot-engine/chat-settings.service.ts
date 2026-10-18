import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { findModule } from './module-registry';
import { isChatTargeted } from '../common/utils/chat-targets.util';

/** Cache entry for effective per-chat config. */
interface CacheEntry {
  config: Record<string, unknown>;
  cachedAt: number;
}

/** How long an effective-config cache entry stays valid (ms). */
const CACHE_TTL_MS = 15_000;

/**
 * Per-chat module configuration layer. For chat-scoped modules the chat
 * entry IS the configuration: effective config merges the registry
 * `defaultConfig` under `chat_module_settings.config_json` for that chat —
 * there is no bot-level layer and no override/inheritance chain. A chat
 * entry existing means the module is targeted at that chat; deleting the
 * entry untargets it (the module stays idle there).
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
   * merged under that chat's own entry. When an entry exists, the returned
   * config carries `targetChats: [chatId]` so runtimes treat the chat as
   * explicitly targeted; without an entry the module is targeted nowhere.
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
    const chatSetting = await this.prisma.chatModuleSetting.findUnique({
      where: { botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey } },
    });

    const chatConfig = chatSetting?.configJson
      ? (JSON.parse(chatSetting.configJson) as Record<string, unknown>)
      : {};
    const config: Record<string, unknown> = {
      ...(definition?.defaultConfig ?? {}),
      ...chatConfig,
    };
    // Entry existence is the targeting signal consumed by every runtime
    // gate (`isChatTargeted(config.targetChats, chatId)`).
    config.targetChats = chatSetting ? [String(chatId)] : [];

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
    return row?.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : null;
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
