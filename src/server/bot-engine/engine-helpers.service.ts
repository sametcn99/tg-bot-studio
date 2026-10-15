import { Injectable } from '@nestjs/common';
import type { User } from 'grammy/types';
import { BotUserModel } from '../modules/users-crm/bot-user.model';
import type { BotUserEntity } from '../modules/users-crm/bot-user.entity';

/**
 * Bot subscriber row shape.
 */
export type BotUserRow = BotUserEntity;

/**
 * Shared audience operations used by the engine middleware and by feature
 * module runtimes (referrals, quizzes, reactions, CRM).
 * Delegated to the typed BotUserModel.
 */
@Injectable()
export class EngineHelpersService {
  /**
   * @param {BotUserModel} userModel - Typed audience and ban model.
   */
  constructor(private readonly userModel: BotUserModel) {}

  /**
   * Upserts a subscriber from a Telegram `from` object, preserving points,
   * referrer, and tags on conflict.
   * @param {number} botId - Owning bot id.
   * @param {User} from - Telegram user payload.
   * @returns {Promise<void>}
   */
  async upsertUser(botId: number, from: User): Promise<void> {
    await this.userModel.upsertUser(botId, {
      telegramId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      languageCode: from.language_code ?? null,
    });
  }

  /**
   * Reads a subscriber row.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @returns {Promise<BotUserRow | null>} Row when the subscriber is known.
   */
  async getUser(botId: number, telegramId: number): Promise<BotUserRow | null> {
    return this.userModel.getUser(botId, telegramId);
  }

  /**
   * Adjusts a subscriber's point balance (negative amounts allowed).
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @param {number} amount - Delta applied to the balance.
   * @returns {Promise<void>}
   */
  async addPoints(botId: number, telegramId: number, amount: number): Promise<void> {
    await this.userModel.addPoints(botId, telegramId, amount);
  }

  /**
   * Records a referrer on first sight and awards referral points.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Newly subscribed user.
   * @param {number} referrerId - Referring user.
   * @param {number} pointsPerReferral - Points granted to the referrer.
   * @returns {Promise<boolean>} True when the attribution was stored.
   */
  async setReferrer(
    botId: number,
    telegramId: number,
    referrerId: number,
    pointsPerReferral: number,
  ): Promise<boolean> {
    return this.userModel.setReferrer(botId, telegramId, referrerId, pointsPerReferral);
  }

  /**
   * Checks whether a user is banned for a bot.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @returns {Promise<boolean>} True when present in `blocked_users`.
   */
  async isBlocked(botId: number, telegramId: number): Promise<boolean> {
    return this.userModel.isBlocked(botId, telegramId);
  }

  /**
   * Bans a user for a bot.
   * @param {number} botId - Owning bot id.
   * @param {User} from - Telegram user payload.
   * @param {string} reason - Ban reason for the audit trail.
   * @returns {Promise<void>}
   */
  async blockUser(botId: number, from: User, reason: string): Promise<void> {
    await this.userModel.blockUser(botId, {
      telegramId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      reason,
    });
  }

  /**
   * Lifts a ban.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @returns {Promise<void>}
   */
  async unblockUser(botId: number, telegramId: number): Promise<void> {
    await this.userModel.unblockUser(botId, telegramId);
  }
}
