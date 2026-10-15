import { Injectable, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { renderTemplate } from '../../common/utils/template.util';
import { SchedulerModel } from './scheduler.model';
import { toScheduledPostRow } from './scheduler.mapper';
import { type ScheduledPostRow } from './scheduler.entity';
import { BotModel } from '../../bots/bot.model';

export { ScheduledPostRow };

/** Dispatch interval for the due-post ticker (30 seconds). */
const TICK_INTERVAL_MS = 30_000;

/**
 * Channel Post Scheduler service: CRUD for scheduled posts plus a 30-second
 * ticker that dispatches due posts with inline buttons and the configured
 * branded caption watermark.
 */
@Injectable()
export class SchedulerService implements OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor(
    private readonly schedulerModel: SchedulerModel,
    private readonly botModel: BotModel,
    private readonly pool: BotPoolService,
  ) {
    this.ticker = setInterval(() => {
      void this.dispatchDue().catch((error: Error) =>
        this.logger.error(`Dispatch failed: ${error.message}`),
      );
    }, TICK_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Lists scheduled posts for a bot.
   */
  async list(botId: number): Promise<ScheduledPostRow[]> {
    const posts = await this.schedulerModel.list(botId);
    return posts.map(toScheduledPostRow);
  }

  /**
   * Reads module configuration for scheduler.
   */
  private async configFor(
    botId: number,
  ): Promise<{ watermarkText: string; timezoneOffsetMinutes: number }> {
    const row = await this.botModel.getModule(botId, 'scheduler');
    const config = row?.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : {};
    return {
      watermarkText: String(config.watermarkText ?? ''),
      timezoneOffsetMinutes: Number(config.timezoneOffsetMinutes ?? 0),
    };
  }

  /**
   * Creates a scheduled post.
   */
  async create(botId: number, data: Record<string, unknown>): Promise<ScheduledPostRow> {
    const config = await this.configFor(botId);
    const offsetMs = config.timezoneOffsetMinutes * 60_000;
    let scheduledAt = String(data.scheduledAt ?? new Date().toISOString());
    if (!scheduledAt.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(scheduledAt)) {
      const parsed = new Date(scheduledAt).getTime();
      if (!Number.isNaN(parsed)) {
        scheduledAt = new Date(parsed - offsetMs).toISOString();
      }
    }

    const target = data.targetChatId;
    const targetChatId =
      typeof target === 'string' && target.startsWith('@') ? target : String(target ?? 0);
    const created = await this.schedulerModel.create({
      botId,
      targetChatId,
      messageText: String(data.messageText ?? ''),
      mediaUrl: (data.mediaUrl as string) || null,
      buttonsJson: data.buttons ? JSON.stringify(data.buttons) : null,
      scheduledAt,
    });
    return toScheduledPostRow(created);
  }

  /**
   * Updates a scheduled post (only while pending).
   */
  async update(
    botId: number,
    id: number,
    data: Record<string, unknown>,
  ): Promise<ScheduledPostRow> {
    const existing = await this.findOne(botId, id);
    const config = await this.configFor(botId);
    const offsetMs = config.timezoneOffsetMinutes * 60_000;
    let scheduledAt =
      data.scheduledAt !== undefined ? String(data.scheduledAt) : existing.scheduled_at;
    if (data.scheduledAt && !scheduledAt.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(scheduledAt)) {
      const parsed = new Date(scheduledAt).getTime();
      if (!Number.isNaN(parsed)) {
        scheduledAt = new Date(parsed - offsetMs).toISOString();
      }
    }

    const target = data.targetChatId !== undefined ? data.targetChatId : existing.target_chat_id;
    const targetChatId =
      typeof target === 'string' && target.startsWith('@') ? target : String(target ?? 0);
    const updated = await this.schedulerModel.update(id, {
      targetChatId,
      messageText:
        data.messageText !== undefined ? String(data.messageText) : existing.message_text,
      mediaUrl:
        data.mediaUrl !== undefined ? (data.mediaUrl as string) || null : existing.media_url,
      buttonsJson: data.buttons ? JSON.stringify(data.buttons) : existing.buttons_json,
      scheduledAt,
    });
    return toScheduledPostRow(updated);
  }

  /**
   * Cancels a scheduled post.
   */
  async remove(botId: number, id: number): Promise<void> {
    await this.findOne(botId, id);
    await this.schedulerModel.delete(id);
  }

  /**
   * Fetches one scheduled post.
   */
  async findOne(botId: number, id: number): Promise<ScheduledPostRow> {
    const row = await this.schedulerModel.findById(botId, id);
    if (!row) throw new NotFoundException(`Scheduled post ${id} not found`);
    return toScheduledPostRow(row);
  }

  /**
   * Dispatches every pending post whose time has arrived.
   */
  private async dispatchDue(): Promise<void> {
    const now = new Date().toISOString();
    const due = await this.schedulerModel.findDue(now);
    for (const post of due) {
      const bot = this.pool.getBot(post.botId);
      if (!bot) continue; // Bot offline; retry on next tick.
      try {
        const config = await this.configFor(post.botId);
        const offsetMs = config.timezoneOffsetMinutes * 60_000;
        const localNow = new Date(Date.now() + offsetMs);

        const body = renderTemplate(post.messageText, {
          group_name: '',
          bot_name: bot.botInfo?.first_name ?? '',
          date: localNow.toISOString().slice(0, 10),
          time: localNow.toISOString().slice(11, 16),
        });
        const text = config.watermarkText ? `${body}\n\n${config.watermarkText}` : body;
        const buttons = post.buttonsJson
          ? (JSON.parse(post.buttonsJson) as Array<{ text: string; url: string }>)
          : [];
        const keyboard = new InlineKeyboard();
        for (const button of buttons) {
          keyboard.url(button.text, button.url).row();
        }
        const options = buttons.length > 0 ? { reply_markup: keyboard } : {};

        const target = post.targetChatId;
        const targetChat =
          target.startsWith('@') || Number.isNaN(Number(target)) ? target : Number(target);

        if (post.mediaUrl && /\.(mp4|mov|webm)$/i.test(post.mediaUrl)) {
          await bot.api.sendVideo(targetChat, post.mediaUrl, {
            caption: text,
            parse_mode: 'HTML',
            ...options,
          });
        } else if (post.mediaUrl) {
          await bot.api.sendPhoto(targetChat, post.mediaUrl, {
            caption: text,
            parse_mode: 'HTML',
            ...options,
          });
        } else {
          await bot.api.sendMessage(targetChat, text, {
            parse_mode: 'HTML',
            ...options,
          });
        }
        await this.schedulerModel.updateStatus(post.id, 'done');
      } catch (error) {
        this.logger.warn(
          `Scheduled post ${post.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await this.schedulerModel.updateStatus(post.id, 'failed');
      }
    }
  }
}
