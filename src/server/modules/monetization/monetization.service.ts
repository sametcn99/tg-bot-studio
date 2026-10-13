import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MonetizationModel, type VipSubscriptionEntity } from '../../models/monetization.model';
import { BotPoolService } from '../../bot-engine/bot-pool.service';

/**
 * VIP subscription row shape.
 */
export type VipSubscriptionRow = VipSubscriptionEntity;

/** Expiry sweep interval (60 seconds). */
const TICK_INTERVAL_MS = 60_000;

/**
 * Monetization service: Telegram Stars paid-media paywall sends and VIP
 * channel subscription lifecycle. Backed by MonetizationModel and Prisma.
 */
@Injectable()
export class MonetizationService implements OnApplicationShutdown {
  private readonly logger = new Logger(MonetizationService.name);
  private readonly ticker: ReturnType<typeof setInterval>;

  /**
   * @param {MonetizationModel} monetizationModel - Domain model for VIP subscriptions.
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   */
  constructor(
    private readonly monetizationModel: MonetizationModel,
    private readonly prisma: PrismaService,
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
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Sends a Stars-locked paid media message to a chat.
   */
  async sendPaidMedia(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<{ messageId: number }> {
    const bot = this.pool.getBot(botId);
    if (!bot) throw new BadRequestException('Bot is not running');

    const mediaType = String(data.mediaType ?? 'photo');
    const rawChatId = data.chatId;
    const chatId =
      typeof rawChatId === 'string' && rawChatId.startsWith('@')
        ? rawChatId
        : Number(rawChatId ?? 0);
    const params: Record<string, unknown> = {
      chat_id: chatId,
      star_count: Number(data.starCount ?? 25),
      media: [{ type: mediaType, media: String(data.mediaUrl ?? '') }],
      caption: data.caption ? String(data.caption) : undefined,
      protect_content: data.protectCaption !== false,
      parse_mode: 'HTML',
    };

    try {
      const result = (await (
        bot.api.raw as unknown as {
          sendPaidMedia: (params: Record<string, unknown>) => Promise<{ message_id: number }>;
        }
      ).sendPaidMedia(params)) as { message_id: number };
      return { messageId: result.message_id };
    } catch (error) {
      throw new BadRequestException(
        `sendPaidMedia failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Grants a VIP subscription by creating a Star-priced invite link.
   */
  async grantVip(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<{ inviteLink: string; expiresAt: string }> {
    const bot = this.pool.getBot(botId);
    if (!bot) throw new BadRequestException('Bot is not running');

    const moduleRow = await this.prisma.botModule.findUnique({
      where: {
        botId_moduleKey: { botId, moduleKey: 'vip-subs' },
      },
    });
    const stored = moduleRow?.configJson
      ? (JSON.parse(moduleRow.configJson) as Record<string, unknown>)
      : {};
    const channelChatId = Number(data.channelChatId ?? stored.channelChatId ?? 0);
    const periodDays = Number(data.periodDays ?? stored.subscriptionPeriodDays ?? 30);
    const starPrice = Number(data.starPrice ?? stored.starPrice ?? 50);
    const telegramId = Number(data.telegramId ?? 0);
    if (!channelChatId || !telegramId) {
      throw new BadRequestException('channelChatId and telegramId are required');
    }

    try {
      const link = (await (
        bot.api.raw as unknown as {
          createChatSubscriptionInviteLink: (params: Record<string, unknown>) => Promise<{
            invite_link: { link: string };
          }>;
        }
      ).createChatSubscriptionInviteLink({
        chat_id: channelChatId,
        subscription_period: periodDays * 86_400,
        subscription_price: starPrice,
        name: `VIP ${periodDays}d`,
      })) as { invite_link: { link: string } };

      const expiresAt = new Date(Date.now() + periodDays * 86_400_000).toISOString();
      await this.monetizationModel.createSubscription({
        botId,
        telegramId,
        channelId: channelChatId,
        expiresAt,
      });

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
   */
  async listVip(botId: number): Promise<VipSubscriptionRow[]> {
    return this.monetizationModel.listSubscriptions(botId);
  }

  /**
   * Revokes a subscription and removes the member from the channel.
   */
  async revokeVip(botId: number, id: number): Promise<void> {
    const row = await this.monetizationModel.findById(botId, id);
    if (!row) throw new NotFoundException(`Subscription ${id} not found`);
    await this.removeMember(botId, row);
    await this.monetizationModel.deactivate(id);
  }

  /**
   * Sweeps expired subscriptions, removing members and deactivating rows.
   */
  private async sweepExpired(): Promise<void> {
    const expired = await this.monetizationModel.findExpired(new Date().toISOString());
    for (const row of expired) {
      await this.removeMember(row.bot_id, row);
      await this.monetizationModel.deactivate(row.id);
      this.logger.log(`VIP subscription ${row.id} expired and removed`);
    }
  }

  /**
   * Removes a subscriber from the protected channel.
   */
  private async removeMember(botId: number, row: VipSubscriptionRow): Promise<void> {
    const bot = this.pool.getBot(botId);
    if (!bot) return;
    await bot.api
      .banChatMember(row.channel_id, row.telegram_id, { until_date: 0 })
      .then(() =>
        bot.api.unbanChatMember(row.channel_id, row.telegram_id, { only_if_banned: true }),
      )
      .catch(() => undefined);
  }
}
