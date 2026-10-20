import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { withDbRetry } from './db-retry';

/**
 * Key-value persistence for global (studio-wide) and per-bot settings stored
 * in `system_settings` and `bot_settings` respectively.
 * Uses Prisma ORM with in-memory write-through cache for instant synchronous access.
 *
 * Writes update the cache immediately and persist through an awaitable,
 * busy-retried database call. Persistence failures are logged loudly and the
 * cache entry is evicted, so reads never serve phantom state that the
 * database does not back. Write methods never reject — callers may `await`
 * them for durability or fire-and-forget them safely.
 */
@Injectable()
export class SystemSettingsService implements OnModuleInit {
  private readonly logger = new Logger(SystemSettingsService.name);
  private readonly systemCache = new Map<string, string>();
  private readonly botCache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pre-loads settings into memory cache on application initialization.
   */
  async onModuleInit(): Promise<void> {
    const system = await this.prisma.systemSetting.findMany();
    for (const s of system) {
      this.systemCache.set(s.key, s.value);
    }

    const bot = await this.prisma.botSetting.findMany();
    for (const b of bot) {
      this.botCache.set(`${b.botId}:${b.key}`, b.value);
    }
  }

  /**
   * Reads a global setting from the cache / system_settings table.
   * @param {string} key - Unique setting key.
   * @returns {string | undefined} Stored value, or undefined when unset.
   */
  getSetting(key: string): string | undefined {
    return this.systemCache.get(key);
  }

  /**
   * Writes (upserts) a global setting via Prisma and updates cache.
   * @param {string} key - Unique setting key.
   * @param {string} value - Serialized value to persist.
   * @returns {Promise<void>} Resolves once persisted (or logged on failure).
   */
  async setSetting(key: string, value: string): Promise<void> {
    this.systemCache.set(key, value);
    try {
      await withDbRetry(
        () =>
          this.prisma.systemSetting.upsert({
            where: { key },
            create: { key, value },
            update: { value },
          }),
        `setSetting:${key}`,
      );
    } catch (error) {
      this.systemCache.delete(key);
      this.logger.error(
        `Failed to persist system setting '${key}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reads a raw string per-bot setting from cache.
   */
  getBotSetting(botId: string, key: string): string | undefined {
    return this.botCache.get(`${botId}:${key}`);
  }

  /**
   * Writes a raw string per-bot setting via Prisma and updates cache.
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key unique per bot.
   * @param {string} value - Raw value to persist.
   * @returns {Promise<void>} Resolves once persisted (or logged on failure).
   */
  async setBotSetting(botId: string, key: string, value: string): Promise<void> {
    this.botCache.set(`${botId}:${key}`, value);
    try {
      await withDbRetry(
        () =>
          this.prisma.botSetting.upsert({
            where: {
              botId_key: { botId, key },
            },
            create: { botId, key, value },
            update: { value },
          }),
        `setBotSetting:${botId}:${key}`,
      );
    } catch (error) {
      this.botCache.delete(`${botId}:${key}`);
      this.logger.error(
        `Failed to persist bot setting '${key}' for bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reads a per-bot setting parsed as JSON.
   * @template T - Expected decoded shape.
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key unique per bot.
   * @returns {T | undefined} Decoded value, or undefined when unset/invalid.
   */
  getBotJson<T>(botId: string, key: string): T | undefined {
    const raw = this.botCache.get(`${botId}:${key}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Malformed JSON in bot setting '${key}' for bot ${botId}`);
      return undefined;
    }
  }

  /**
   * Writes (upserts) a per-bot setting serialized as JSON via Prisma.
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key unique per bot.
   * @param {unknown} value - Value to serialize and persist.
   * @returns {Promise<void>} Resolves once persisted (or logged on failure).
   */
  async setBotJson(botId: string, key: string, value: unknown): Promise<void> {
    const str = JSON.stringify(value);
    this.botCache.set(`${botId}:${key}`, str);
    try {
      await withDbRetry(
        () =>
          this.prisma.botSetting.upsert({
            where: {
              botId_key: { botId, key },
            },
            create: { botId, key, value: str },
            update: { value: str },
          }),
        `setBotJson:${botId}:${key}`,
      );
    } catch (error) {
      this.botCache.delete(`${botId}:${key}`);
      this.logger.error(
        `Failed to persist bot setting '${key}' for bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Deletes a per-bot setting (cache + database).
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key to remove.
   * @returns {Promise<void>} Resolves once deleted (or logged on failure).
   */
  async deleteBotSetting(botId: string, key: string): Promise<void> {
    this.botCache.delete(`${botId}:${key}`);
    try {
      await withDbRetry(
        () => this.prisma.botSetting.delete({ where: { botId_key: { botId, key } } }),
        `deleteBotSetting:${botId}:${key}`,
      );
    } catch (error) {
      // A missing row is fine (delete is idempotent for our purposes); real
      // failures are logged so operators can see lost deletions.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('P2025')) {
        this.logger.error(`Failed to delete bot setting '${key}' for bot ${botId}: ${message}`);
      }
    }
  }

  /**
   * Lists per-bot settings whose key starts with the prefix, decoded from
   * their raw string values. Used by dashboard views (e.g. open AI
   * escalations) that enumerate dynamic keys.
   * @param {number} botId - Owning bot identifier.
   * @param {string} prefix - Key prefix filter.
   * @returns {Array<{key: string, value: string}>} Matching settings.
   */
  listBotSettingsByPrefix(botId: string, prefix: string): Array<{ key: string; value: string }> {
    const out: Array<{ key: string; value: string }> = [];
    for (const [composite, value] of this.botCache) {
      const [owner, ...rest] = composite.split(':');
      if (owner === botId && rest.join(':').startsWith(prefix)) {
        out.push({ key: rest.join(':'), value });
      }
    }
    return out;
  }

  /**
   * Reloads all cached settings for a bot from the database.
   * @param {number} botId - Bot whose entries should be refreshed.
   * @returns {void}
   */
  invalidateBotCache(botId: string): void {
    const prefix = `${botId}:`;
    for (const composite of this.botCache.keys()) {
      if (composite.startsWith(prefix)) this.botCache.delete(composite);
    }
    void this.prisma.botSetting
      .findMany({ where: { botId } })
      .then((rows) => {
        for (const row of rows) {
          this.botCache.set(`${row.botId}:${row.key}`, row.value);
        }
      })
      .catch(() => undefined);
  }
}
