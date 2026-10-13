import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Key-value persistence for global (studio-wide) and per-bot settings stored
 * in `system_settings` and `bot_settings` respectively.
 * Uses Prisma ORM with in-memory write-through cache for instant synchronous access.
 */
@Injectable()
export class SystemSettingsService implements OnModuleInit {
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
   * @returns {void}
   */
  setSetting(key: string, value: string): void {
    this.systemCache.set(key, value);
    void this.prisma.systemSetting
      .upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
      .catch(() => undefined);
  }

  /**
   * Reads a raw string per-bot setting from cache.
   */
  getBotSetting(botId: number, key: string): string | undefined {
    return this.botCache.get(`${botId}:${key}`);
  }

  /**
   * Writes a raw string per-bot setting via Prisma and updates cache.
   */
  setBotSetting(botId: number, key: string, value: string): void {
    this.botCache.set(`${botId}:${key}`, value);
    void this.prisma.botSetting
      .upsert({
        where: {
          botId_key: { botId, key },
        },
        create: { botId, key, value },
        update: { value },
      })
      .catch(() => undefined);
  }

  /**
   * Reads a per-bot setting parsed as JSON.
   * @template T - Expected decoded shape.
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key unique per bot.
   * @returns {T | undefined} Decoded value, or undefined when unset/invalid.
   */
  getBotJson<T>(botId: number, key: string): T | undefined {
    const raw = this.botCache.get(`${botId}:${key}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Writes (upserts) a per-bot setting serialized as JSON via Prisma.
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key unique per bot.
   * @param {unknown} value - Value to serialize and persist.
   * @returns {void}
   */
  setBotJson(botId: number, key: string, value: unknown): void {
    const str = JSON.stringify(value);
    this.botCache.set(`${botId}:${key}`, str);
    void this.prisma.botSetting
      .upsert({
        where: {
          botId_key: { botId, key },
        },
        create: { botId, key, value: str },
        update: { value: str },
      })
      .catch(() => undefined);
  }
}
