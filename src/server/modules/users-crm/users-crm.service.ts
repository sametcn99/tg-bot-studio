import { Injectable, NotFoundException } from '@nestjs/common';
import { BotUserModel } from '../../models/bot-user.model';
import type { BotUserRow } from '../../bot-engine/engine-helpers.service';

/**
 * CRM profile shape returned to the dashboard (tags parsed from JSON).
 * @interface CrmUser
 */
export interface CrmUser extends Omit<BotUserRow, 'tags_json'> {
  tags: string[];
  notes: string;
}

/**
 * Audience CRM: subscriber search, tag/note management, and export.
 * Backed by typed BotUserModel.
 */
@Injectable()
export class UsersCrmService {
  /**
   * @param {BotUserModel} userModel - Typed audience model.
   */
  constructor(private readonly userModel: BotUserModel) {}

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
   * @returns {Promise<CrmUser[]>} Matching subscriber profiles.
   */
  async list(botId: number, filters?: { search?: string; tag?: string }): Promise<CrmUser[]> {
    const rows = await this.userModel.listUsers(botId, 2000);
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
   * @returns {Promise<CrmUser>} Decoded profile.
   * @throws {NotFoundException} When the subscriber is unknown.
   */
  async findOne(botId: number, telegramId: number): Promise<CrmUser> {
    const row = await this.userModel.getUser(botId, telegramId);
    if (!row) throw new NotFoundException(`Subscriber ${telegramId} not found`);
    return this.decode(row);
  }

  /**
   * Replaces the tag set and notes for a subscriber.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @param {string[]} tags - Full replacement tag list.
   * @param {string} notes - Internal notes text.
   * @returns {Promise<CrmUser>} Updated profile.
   */
  async updateTags(
    botId: number,
    telegramId: number,
    tags: string[],
    notes: string,
  ): Promise<CrmUser> {
    await this.findOne(botId, telegramId);
    const updated = await this.userModel.updateTags(
      botId,
      telegramId,
      JSON.stringify({ tags, notes }),
    );
    return this.decode(updated);
  }

  /**
   * Exports subscribers as CSV or JSON.
   * @param {number} botId - Owning bot id.
   * @param {'csv'|'json'} format - Export format.
   * @returns {Promise<string>} Serialized export document.
   */
  async export(botId: number, format: 'csv' | 'json'): Promise<string> {
    const users = await this.list(botId);
    if (format === 'json') return JSON.stringify(users, null, 2);
    const header =
      'telegram_id,username,first_name,last_name,language_code,points,referrer_id,tags,notes,first_seen_at,last_seen_at';
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
        .map((cell) =>
          /[",]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell),
        )
        .join(','),
    );
    return [header, ...lines].join('\r\n');
  }

  /**
   * Aggregated tag inventory for filter chips.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<string[]>} Distinct tags in use.
   */
  async distinctTags(botId: number): Promise<string[]> {
    const users = await this.list(botId);
    return [...new Set(users.flatMap((user) => user.tags))].sort();
  }
}
