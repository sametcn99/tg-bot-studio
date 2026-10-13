import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { BroadcastModel, toBroadcastRow, type BroadcastRow } from '../../models/broadcast.model';
import { BotModel } from '../../models/bot.model';
import type { BotUserEntity } from '../../models/bot-user.model';

export { BroadcastRow };

/**
 * Inbound broadcast button descriptor.
 * @interface BroadcastButton
 * @property {string} text - Inline button label.
 * @property {string} url - Inline button target URL.
 */
interface BroadcastButton {
  text: string;
  url: string;
}

/**
 * Enterprise broadcast engine. Resolves the target audience, queues the
 * send-out with conservative rate limiting (Telegram 429 protection on top of
 * the grammY auto-retry transformer), and tracks per-broadcast counters.
 */
@Injectable()
export class BroadcastService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly cancelledBroadcasts = new Set<number>();

  constructor(
    private readonly broadcastModel: BroadcastModel,
    private readonly botModel: BotModel,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Cleans up stale in-flight broadcasts from previous runs on server boot.
   */
  async onModuleInit(): Promise<void> {
    const swept = await this.broadcastModel.sweepInterrupted();
    if (swept > 0) {
      this.logger.warn(`Swept ${swept} stalled broadcast(s) to 'interrupted' status on startup`);
    }
  }

  /**
   * Lists broadcast history for a bot.
   */
  async list(botId: number): Promise<BroadcastRow[]> {
    const broadcasts = await this.broadcastModel.list(botId);
    return broadcasts.map(toBroadcastRow);
  }

  /**
   * Creates a broadcast and starts the background queue.
   */
  async create(botId: number, data: Record<string, unknown>): Promise<BroadcastRow> {
    const item = await this.broadcastModel.create({
      botId,
      targetType: String(data.targetType ?? 'all'),
      messageText: String(data.messageText ?? ''),
      mediaUrl: (data.mediaUrl as string) || null,
      buttonsJson: data.buttons ? JSON.stringify(data.buttons) : null,
    });
    const row = toBroadcastRow(item);
    void this.runQueue(botId, row.id, data);
    return row;
  }

  /**
   * Fetches one broadcast.
   */
  async findOne(botId: number, id: number): Promise<BroadcastRow> {
    const item = await this.broadcastModel.findById(botId, id);
    if (!item) throw new NotFoundException(`Broadcast ${id} not found`);
    return toBroadcastRow(item);
  }

  /**
   * Cancels a running or queued broadcast.
   */
  async cancel(botId: number, id: number): Promise<BroadcastRow> {
    const broadcast = await this.findOne(botId, id);
    if (broadcast.status !== 'running' && broadcast.status !== 'queued') {
      return broadcast;
    }
    this.cancelledBroadcasts.add(id);
    const updated = await this.broadcastModel.updateStatus(id, {
      status: 'cancelled',
    });
    this.logger.log(`Broadcast ${id} for bot ${botId} marked cancelled`);
    return toBroadcastRow(updated);
  }

  /**
   * Resolves the audience for a target type.
   */
  private async resolveAudience(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<BotUserEntity[]> {
    return this.broadcastModel.resolveAudience(botId, {
      targetType: data.targetType as string,
      language: data.language as string,
      recentDays: data.recentDays as number,
    });
  }

  /**
   * Executes the queued send-out with rate limiting and counter tracking.
   */
  private async runQueue(
    botId: number,
    broadcastId: number,
    data: Record<string, unknown>,
  ): Promise<void> {
    const bot = this.pool.getBot(botId);
    if (!bot) {
      await this.broadcastModel.updateStatus(broadcastId, { status: 'failed' });
      return;
    }

    const moduleRow = await this.botModel.getModule(botId, 'broadcast');
    const config = moduleRow?.configJson
      ? (JSON.parse(moduleRow.configJson) as Record<string, unknown>)
      : {};
    const perSecond = Number(config.rateLimitPerSecond ?? 20);
    const delayMs = Math.max(30, Math.round(1000 / Math.max(1, perSecond)));
    const batchSize = Math.max(1, Number(config.batchSize ?? 30));
    const pauseBetweenBatchesMs = Math.max(0, Number(config.pauseBetweenBatchesMs ?? 0));

    const audience = await this.resolveAudience(botId, data);
    await this.broadcastModel.updateStatus(broadcastId, {
      status: 'running',
      totalRecipients: audience.length,
    });

    const buttons: BroadcastButton[] = data.buttons ? (data.buttons as BroadcastButton[]) : [];
    const keyboard = new InlineKeyboard();
    for (const button of buttons) {
      keyboard.url(button.text, button.url).row();
    }
    const replyMarkup = buttons.length > 0 ? keyboard : undefined;
    const mediaUrl = (data.mediaUrl as string) || undefined;

    let success = 0;
    let failed = 0;
    let batchCounter = 0;

    for (const recipient of audience) {
      if (this.cancelledBroadcasts.has(broadcastId)) {
        this.cancelledBroadcasts.delete(broadcastId);
        await this.broadcastModel.updateStatus(broadcastId, {
          status: 'cancelled',
          successCount: success,
          failedCount: failed,
        });
        this.logger.log(`Broadcast ${broadcastId} stopped early due to cancellation`);
        return;
      }

      try {
        const mention = recipient.username
          ? `@${recipient.username}`
          : `<a href="tg://user?id=${recipient.telegram_id}">${recipient.first_name ?? recipient.telegram_id}</a>`;
        const text = (data.messageText as string)
          .replace(/\{first_name\}/g, recipient.first_name ?? '')
          .replace(/\{last_name\}/g, recipient.last_name ?? '')
          .replace(/\{username\}/g, recipient.username ?? '')
          .replace(/\{user_id\}/g, String(recipient.telegram_id))
          .replace(/\{mention\}/g, mention);

        const options: Record<string, unknown> = {
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        };
        if (mediaUrl) {
          await bot.api.sendPhoto(recipient.telegram_id, mediaUrl, {
            caption: text,
            ...options,
          });
        } else {
          await bot.api.sendMessage(recipient.telegram_id, text, options);
        }
        success++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Broadcast ${broadcastId} delivery failed for user ${recipient.telegram_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      batchCounter++;
      if (pauseBetweenBatchesMs > 0 && batchCounter % batchSize === 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseBetweenBatchesMs));
      } else {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    await this.broadcastModel.updateStatus(broadcastId, {
      status: 'done',
      successCount: success,
      failedCount: failed,
    });
    this.logger.log(`Broadcast ${broadcastId} finished: ${success} sent, ${failed} failed`);
  }
}
