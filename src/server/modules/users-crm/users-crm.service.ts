import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { BotUserRow } from '../../bot-engine/engine-helpers.service';

/**
 * CRM profile shape returned to the dashboard (tags parsed from JSON).
 * @interface CrmUser
 * @property {number} telegram_id - Subscriber Telegram id.
 * @property {string[]} tags - Operator-assigned tags.
 * @property {string} notes - Operator internal notes.
 */
export interface CrmUser extends Omit<BotUserRow, 'tags_json'> {
  tags: string[];
  notes: string;
}

/**
 * Audience CRM: subscriber search, tag/note management, and export.
 */
@Injectable()
export class UsersCrmService {
  /**
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(private readonly db: DatabaseService) {}

  /**
   * Decodes a raw bot_users row into the CRM shape.
   * @param {BotUserRow} row - Raw database row.
   * @returns {CrmUser} Decoded profile.
   */
  private decode(row: BotUserRow): CrmUser {
    const parsed = row.tags_json
      ? (JSON.parse(row.tags_json) as { tags?: string[]; notes?: string })
      : {};
    const { tags_json: _tagsJson, ...rest } = row;
    return { ...rest, tags: parsed.tags ?? [], notes: parsed.notes ?? '' };
  }

  /**
   * Lists subscribers with optional search and tag filters.
   * @param {number} botId - Owning bot id.
   * @param {object} [filters] - Optional filters.
   * @param {string} [filters.search] - Matches username/name/telegram id.
   * @param {string} [filters.tag] - Requires the tag to be present.
   * @returns {CrmUser[]} Matching subscriber profiles.
   */
  list(botId: number, filters?: { search?: string; tag?: string }): CrmUser[] {
    const rows = this.db.query<BotUserRow>(
      'SELECT * FROM bot_users WHERE bot_id = ? ORDER BY last_seen_at DESC LIMIT 2000',
      botId,
    );
    let users = rows.map((row) => this.decode(row));
    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      users = users.filter(
        (user) =>
          (user.username ?? '').toLowerCase().includes(needle) ||
          (user.first_name ?? '').toLowerCase().includes(needle) ||
          (user.last_name ?? '').toLowerCase().includes(needle) ||
          String(user.telegram_id).includes(needle),
      );
    }
    if (filters?.tag) {
      users = users.filter((user) => user.tags.includes(filters.tag!));
    }
    return users;
  }

  /**
   * Fetches one subscriber profile.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @returns {CrmUser} Decoded profile.
   * @throws {NotFoundException} When the subscriber is unknown.
   */
  findOne(botId: number, telegramId: number): CrmUser {
    const row = this.db.get<BotUserRow>(
      'SELECT * FROM bot_users WHERE bot_id = ? AND telegram_id = ?',
      botId,
      telegramId,
    );
    if (!row) throw new NotFoundException(`Subscriber ${telegramId} not found`);
    return this.decode(row);
  }

  /**
   * Replaces the tag set and notes for a subscriber.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @param {string[]} tags - Full replacement tag list.
   * @param {string} notes - Internal notes text.
   * @returns {CrmUser} Updated profile.
   */
  updateTags(botId: number, telegramId: number, tags: string[], notes: string): CrmUser {
    this.findOne(botId, telegramId);
    this.db.run(
      'UPDATE bot_users SET tags_json = ? WHERE bot_id = ? AND telegram_id = ?',
      JSON.stringify({ tags, notes }),
      botId,
      telegramId,
    );
    return this.findOne(botId, telegramId);
  }

  /**
   * Exports subscribers as CSV or JSON.
   * @param {number} botId - Owning bot id.
   * @param {'csv'|'json'} format - Export format.
   * @returns {string} Serialized export document.
   */
  export(botId: number, format: 'csv' | 'json'): string {
    const users = this.list(botId);
    if (format === 'json') return JSON.stringify(users, null, 2);
    const header = 'telegram_id,username,first_name,last_name,language_code,points,referrer_id,tags,notes,first_seen_at,last_seen_at';
    const lines = users.map((user) =>
      [
        user.telegram_id,
        user.username ?? '',
        user.first_name ?? '',
        user.last_name ?? '',
        user.language_code ?? '',
        user.points,
        user.referrer_id ?? '',
        user.tags.join('|'),
        user.notes.replace(/[\r\n]+/g, ' '),
        user.first_seen_at ?? '',
        user.last_seen_at ?? '',
      ]
        .map((cell) => /[",]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell))
        .join(','),
    );
    return [header, ...lines].join('\r\n');
  }

  /**
   * Aggregated tag inventory for filter chips.
   * @param {number} botId - Owning bot id.
   * @returns {string[]} Distinct tags in use.
   */
  distinctTags(botId: number): string[] {
    const users = this.list(botId);
    return [...new Set(users.flatMap((user) => user.tags))].sort();
  }
}
