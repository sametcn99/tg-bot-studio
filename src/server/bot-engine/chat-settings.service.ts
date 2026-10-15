import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { findModule } from './module-registry';

/** Cache entry for effective per-chat config. */
interface CacheEntry {
  config: Record<string, unknown>;
  cachedAt: number;
}

/** How long an effective-config cache entry stays valid (ms). */
const CACHE_TTL_MS = 15_000;

/**
 * Per-chat module configuration layer (reference parity). Effective config for a
 * chat merges in order: registry `defaultConfig` <- bot-level
 * `bot_modules.config_json` <- `chat_module_settings.config_json` override.
 * Runtimes read this inside their handlers (mirroring the autoresponder
 * per-message DB pattern) instead of the attach-time bot snapshot.
 */
@Injectable()
export class ChatSettingsService {
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads the effective module config for one chat (defaults + bot level +
   * chat override), cached briefly to keep per-message reads cheap.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<Record<string, unknown>>} Effective configuration.
   */
  async getEffectiveConfig(
    botId: number,
    chatId: string | number,
    moduleKey: string,
  ): Promise<Record<string, unknown>> {
    const key = `${botId}:${chatId}:${moduleKey}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.config;
    }

    const definition = findModule(moduleKey);
    const botModule = await this.prisma.botModule.findUnique({
      where: { botId_moduleKey: { botId, moduleKey } },
    });
    const chatSetting = await this.prisma.chatModuleSetting.findUnique({
      where: { botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey } },
    });

    const botConfig = botModule?.configJson
      ? (JSON.parse(botModule.configJson) as Record<string, unknown>)
      : {};
    const chatConfig = chatSetting?.configJson
      ? (JSON.parse(chatSetting.configJson) as Record<string, unknown>)
      : {};
    const config = {
      ...(definition?.defaultConfig ?? {}),
      ...botConfig,
      ...chatConfig,
    };

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
    botId: number,
    chatId: string | number,
    moduleKey: string,
    field: string,
  ): Promise<unknown> {
    const config = await this.getEffectiveConfig(botId, chatId, moduleKey);
    return config[field];
  }

  /**
   * Reads the raw chat override for one module (no defaults merged).
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<Record<string, unknown> | null>} Override fields or null.
   */
  async getOverride(
    botId: number,
    chatId: string | number,
    moduleKey: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.chatModuleSetting.findUnique({
      where: { botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey } },
    });
    return row?.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : null;
  }

  /**
   * Saves (or replaces) a chat-level override and refreshes the cache.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @param {Record<string, unknown>} config - Override fields to persist.
   * @returns {Promise<void>} Resolves once stored.
   */
  async setOverride(
    botId: number,
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
   * Removes a chat-level override so the chat falls back to bot defaults.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<void>} Resolves once deleted (no-op when absent).
   */
  async clearOverride(botId: number, chatId: string | number, moduleKey: string): Promise<void> {
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
  invalidate(botId?: number, chatId?: string | number, moduleKey?: string): void {
    for (const key of this.cache.keys()) {
      const [keyBot, keyChat, keyModule] = key.split(':');
      if (botId !== undefined && keyBot !== String(botId)) continue;
      if (chatId !== undefined && keyChat !== String(chatId)) continue;
      if (moduleKey !== undefined && keyModule !== moduleKey) continue;
      this.cache.delete(key);
    }
  }
}
