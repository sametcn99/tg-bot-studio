import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';

/**
 * VIP subscription row in the `vip_subscriptions` table.
 * @interface VipSubscriptionRow
 * @property {number} id - Subscription identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {number} telegram_id - Subscriber Telegram id.
 * @property {number} channel_id - Protected channel id.
 * @property {string} expires_at - ISO expiry timestamp.
 * @property {number} is_active - Active flag.
 */
export interface VipSubscriptionRow {
  id: number;
  bot_id: number;
  telegram_id: number;
  channel_id: number;
  expires_at: string;
  is_active: number;
}

/** Expiry sweep interval (60 seconds). */
const TICK_INTERVAL_MS = 60_000;

/**
 * Monetization service: Telegram Stars paid-media paywall sends and VIP
 * channel subscription lifecycle (Star-priced invite links plus an expiry
 * sweeper that removes lapsed members).
 */
@Injectable()
export class MonetizationService implements OnApplicationShutdown {
  private readonly logger = new Logger(MonetizationService.name);
  private readonly ticker: ReturnType<typeof setInterval>;

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
  ) {
    this.ticker = setInterval(() => {
      void this.sweepExpired().catch((error: Error) =>
        this.logger.error(`VIP sweep failed: ${error.message}`),
      );
    }, TICK_INTERVAL_MS);
  }

  /**
   * Stops the expiry sweeper on shutdown.
   * @returns {void}
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Sends a Stars-locked paid media message to a chat.
   * @param {number} botId - Owning bot id.
   * @param {object} data - chatId, mediaType ('photo'|'video'), mediaUrl, caption, starCount.
   * @returns {Promise<{messageId: number}>} Sent message identifier.
   * @throws {BadRequestException} When the module is disabled or Telegram rejects the call.
   */
  async sendPaidMedia(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<{ messageId: number }> {
    const bot = this.pool.getBot(botId);
    if (!bot) throw new BadRequestException('Bot is not running');

    const mediaType = String(data.mediaType ?? 'photo');
    // Connections may reference public chats by @username; numeric ids stay numbers.
    const rawChatId = data.chatId;
    const chatId =
      typeof rawChatId === 'string' && rawChatId.startsWith('@') ? rawChatId : Number(rawChatId ?? 0);
    const params: Record<string, unknown> = {
      chat_id: chatId,
      star_count: Number(data.starCount ?? 25),
      media: [{ type: mediaType, media: String(data.mediaUrl ?? '') }],
      caption: data.caption ? String(data.caption) : undefined,
      protect_content: data.protectCaption !== false,
      parse_mode: 'HTML',
    };

    try {
      const result = (await (bot.api.raw as unknown as {
        sendPaidMedia: (params: Record<string, unknown>) => Promise<{ message_id: number }>;
      }).sendPaidMedia(params)) as { message_id: number };
      return { messageId: result.message_id };
    } catch (error) {
      throw new BadRequestException(
        `sendPaidMedia failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Grants a VIP subscription by creating a Star-priced invite link and
   * sending it to the user.
   * @param {number} botId - Owning bot id.
   * @param {object} data - telegramId, channelChatId?, periodDays?, starPrice?.
   * @returns {Promise<{inviteLink: string; expiresAt: string}>} Link and expiry.
   * @throws {BadRequestException} When the bot is offline or Telegram rejects the call.
   */
  async grantVip(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<{ inviteLink: string; expiresAt: string }> {
    const bot = this.pool.getBot(botId);
    if (!bot) throw new BadRequestException('Bot is not running');

    const moduleRow = this.db.get<{ config_json: string | null }>(
      "SELECT config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'vip-subs'",
      botId,
    );
    const stored = moduleRow?.config_json ? (JSON.parse(moduleRow.config_json) as Record<string, unknown>) : {};
    const channelChatId = Number(data.channelChatId ?? stored.channelChatId ?? 0);
    const periodDays = Number(data.periodDays ?? stored.subscriptionPeriodDays ?? 30);
    const starPrice = Number(data.starPrice ?? stored.starPrice ?? 50);
    const telegramId = Number(data.telegramId ?? 0);
    if (!channelChatId || !telegramId) {
      throw new BadRequestException('channelChatId and telegramId are required');
    }

    try {
      const link = (await (bot.api.raw as unknown as {
        createChatSubscriptionInviteLink: (params: Record<string, unknown>) => Promise<{
          invite_link: { link: string };
        }>;
      }).createChatSubscriptionInviteLink({
        chat_id: channelChatId,
        subscription_period: periodDays * 86_400,
        subscription_price: starPrice,
        name: `VIP ${periodDays}d`,
      })) as { invite_link: { link: string } };

      const expiresAt = new Date(Date.now() + periodDays * 86_400_000).toISOString();
      this.db.run(
        'INSERT INTO vip_subscriptions (bot_id, telegram_id, channel_id, expires_at, is_active) VALUES (?, ?, ?, ?, 1)',
        botId,
        telegramId,
        channelChatId,
        expiresAt,
      );
      await bot.api
        .sendMessage(
          telegramId,
          `Your VIP subscription invite link (renews at ${starPrice} Stars / ${periodDays} days):\n${link.invite_link.link}`,
        )
        .catch(() => undefined);
      return { inviteLink: link.invite_link.link, expiresAt };
    } catch (error) {
      throw new BadRequestException(
        `createChatSubscriptionInviteLink failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Lists VIP subscriptions for a bot.
   * @param {number} botId - Owning bot id.
   * @returns {VipSubscriptionRow[]} Subscription rows.
   */
  listVip(botId: number): VipSubscriptionRow[] {
    return this.db.query<VipSubscriptionRow>(
      'SELECT * FROM vip_subscriptions WHERE bot_id = ? ORDER BY id DESC',
      botId,
    );
  }

  /**
   * Revokes a subscription and removes the member from the channel.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Subscription identifier.
   * @returns {Promise<void>} Resolves once revoked.
   * @throws {NotFoundException} When the subscription does not exist.
   */
  async revokeVip(botId: number, id: number): Promise<void> {
    const row = this.db.get<VipSubscriptionRow>(
      'SELECT * FROM vip_subscriptions WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!row) throw new NotFoundException(`Subscription ${id} not found`);
    await this.removeMember(botId, row);
    this.db.run('UPDATE vip_subscriptions SET is_active = 0 WHERE id = ?', id);
  }

  /**
   * Sweeps expired subscriptions, removing members and deactivating rows.
   * @returns {Promise<void>} Resolves once the sweep completed.
   */
  private async sweepExpired(): Promise<void> {
    const expired = this.db.query<VipSubscriptionRow>(
      'SELECT * FROM vip_subscriptions WHERE is_active = 1 AND expires_at <= ?',
      new Date().toISOString(),
    );
    for (const row of expired) {
      await this.removeMember(row.bot_id, row);
      this.db.run('UPDATE vip_subscriptions SET is_active = 0 WHERE id = ?', row.id);
      this.logger.log(`VIP subscription ${row.id} expired and removed`);
    }
  }

  /**
   * Removes a subscriber from the protected channel (kick without ban).
   * @param {number} botId - Owning bot id.
   * @param {VipSubscriptionRow} row - Subscription row.
   * @returns {Promise<void>} Resolves once attempted.
   */
  private async removeMember(botId: number, row: VipSubscriptionRow): Promise<void> {
    const bot = this.pool.getBot(botId);
    if (!bot) return;
    await bot.api
      .banChatMember(row.channel_id, row.telegram_id, { until_date: 0 })
      .then(() => bot.api.unbanChatMember(row.channel_id, row.telegram_id, { only_if_banned: true }))
      .catch(() => undefined);
  }
}
