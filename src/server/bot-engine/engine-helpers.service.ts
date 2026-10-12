import { Injectable } from '@nestjs/common';
import type { User } from 'grammy/types';
import { DatabaseService } from '../database/database.service';

/**
 * Bot subscriber row in the `bot_users` table.
 * @interface BotUserRow
 * @property {number} bot_id - Owning bot id.
 * @property {number} telegram_id - Subscriber Telegram id.
 * @property {string} [username] - Telegram @username.
 * @property {string} [first_name] - First name.
 * @property {string} [last_name] - Last name.
 * @property {string} [language_code] - Telegram client language.
 * @property {number} points - Gamification point balance.
 * @property {number} [referrer_id] - Telegram id of the referring user.
 * @property {string} [tags_json] - JSON object with `tags` and `notes` arrays.
 */
export interface BotUserRow {
  bot_id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  points: number;
  referrer_id: number | null;
  tags_json: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

/**
 * Shared audience operations used by the engine middleware and by feature
 * module runtimes (referrals, quizzes, reactions, CRM).
 */
@Injectable()
export class EngineHelpersService {
  /**
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(private readonly db: DatabaseService) {}

  /**
   * Upserts a subscriber from a Telegram `from` object, preserving points,
   * referrer, and tags on conflict.
   * @param {number} botId - Owning bot id.
   * @param {User} from - Telegram user payload.
   * @returns {void}
   */
  upsertUser(botId: number, from: User): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO bot_users (bot_id, telegram_id, username, first_name, last_name, language_code, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bot_id, telegram_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         language_code = COALESCE(excluded.language_code, bot_users.language_code),
         last_seen_at = excluded.last_seen_at`,
      botId,
      from.id,
      from.username ?? null,
      from.first_name ?? null,
      from.last_name ?? null,
      from.language_code ?? null,
      now,
      now,
    );
  }

  /**
   * Reads a subscriber row.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @returns {BotUserRow | undefined} Row when the subscriber is known.
   */
  getUser(botId: number, telegramId: number): BotUserRow | undefined {
    return this.db.get<BotUserRow>(
      'SELECT * FROM bot_users WHERE bot_id = ? AND telegram_id = ?',
      botId,
      telegramId,
    );
  }

  /**
   * Adjusts a subscriber's point balance (negative amounts allowed).
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @param {number} amount - Delta applied to the balance.
   * @returns {void}
   */
  addPoints(botId: number, telegramId: number, amount: number): void {
    this.db.run(
      'UPDATE bot_users SET points = MAX(0, points + ?) WHERE bot_id = ? AND telegram_id = ?',
      amount,
      botId,
      telegramId,
    );
  }

  /**
   * Records a referrer on first sight and awards referral points.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Newly subscribed user.
   * @param {number} referrerId - Referring user.
   * @param {number} pointsPerReferral - Points granted to the referrer.
   * @returns {boolean} True when the attribution was stored.
   */
  setReferrer(
    botId: number,
    telegramId: number,
    referrerId: number,
    pointsPerReferral: number,
  ): boolean {
    if (telegramId === referrerId) return false;
    const existing = this.getUser(botId, telegramId);
    if (existing?.referrer_id) return false;
    const referrerExists = this.getUser(botId, referrerId);
    if (!referrerExists) return false;
    this.db.run(
      'UPDATE bot_users SET referrer_id = ? WHERE bot_id = ? AND telegram_id = ?',
      referrerId,
      botId,
      telegramId,
    );
    this.addPoints(botId, referrerId, pointsPerReferral);
    return true;
  }

  /**
   * Checks whether a user is banned for a bot.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @returns {boolean} True when present in `blocked_users`.
   */
  isBlocked(botId: number, telegramId: number): boolean {
    return Boolean(
      this.db.get(
        'SELECT 1 FROM blocked_users WHERE bot_id = ? AND telegram_id = ?',
        botId,
        telegramId,
      ),
    );
  }

  /**
   * Bans a user for a bot.
   * @param {number} botId - Owning bot id.
   * @param {User} from - Telegram user payload.
   * @param {string} reason - Ban reason for the audit trail.
   * @returns {void}
   */
  blockUser(botId: number, from: User, reason: string): void {
    this.db.run(
      `INSERT INTO blocked_users (bot_id, telegram_id, username, first_name, reason, blocked_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(bot_id, telegram_id) DO UPDATE SET reason = excluded.reason`,
      botId,
      from.id,
      from.username ?? null,
      from.first_name ?? null,
      reason,
      new Date().toISOString(),
    );
  }

  /**
   * Lifts a ban.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @returns {void}
   */
  unblockUser(botId: number, telegramId: number): void {
    this.db.run(
      'DELETE FROM blocked_users WHERE bot_id = ? AND telegram_id = ?',
      botId,
      telegramId,
    );
  }
}
