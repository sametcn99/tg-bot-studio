import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Key-value persistence for global (studio-wide) and per-bot settings stored
 * in `system_settings` and `bot_settings` respectively.
 */
@Injectable()
export class SystemSettingsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Reads a global setting from the `system_settings` table.
   * @param {string} key - Unique setting key.
   * @returns {string | undefined} Stored value, or undefined when unset.
   */
  getSetting(key: string): string | undefined {
    const row = this.db.get<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      key,
    );
    return row?.value;
  }

  /**
   * Writes (upserts) a global setting.
   * @param {string} key - Unique setting key.
   * @param {string} value - Serialized value to persist.
   * @returns {void}
   */
  setSetting(key: string, value: string): void {
    this.db.run(
      `INSERT INTO system_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  /**
   * Reads a per-bot setting parsed as JSON.
   * @template T - Expected decoded shape.
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key unique per bot.
   * @returns {T | undefined} Decoded value, or undefined when unset/invalid.
   */
  getBotJson<T>(botId: number, key: string): T | undefined {
    const row = this.db.get<{ value: string }>(
      'SELECT value FROM bot_settings WHERE bot_id = ? AND key = ?',
      botId,
      key,
    );
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Writes (upserts) a per-bot setting serialized as JSON.
   * @param {number} botId - Owning bot identifier.
   * @param {string} key - Setting key unique per bot.
   * @param {unknown} value - Value to serialize and persist.
   * @returns {void}
   */
  setBotJson(botId: number, key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO bot_settings (bot_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(bot_id, key) DO UPDATE SET value = excluded.value`,
      botId,
      key,
      JSON.stringify(value),
    );
  }
}
