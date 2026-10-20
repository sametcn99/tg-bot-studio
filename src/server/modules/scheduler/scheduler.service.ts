import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { renderTemplate } from '../../common/utils/template.util';
import { safeTimeZone, wallTimeToUtc } from '../../common/utils/tz.util';
import { safeJsonObjectParse } from '../../common/utils/json.util';
import { normalizeChatTargets } from '../../common/utils/chat-targets.util';
import { SystemSettingsService } from '../../database/system-settings.service';
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
  private isRunning = false;

  constructor(
    private readonly schedulerModel: SchedulerModel,
    private readonly botModel: BotModel,
    private readonly pool: BotPoolService,
    private readonly settings: SystemSettingsService,
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
  async list(botId: string): Promise<ScheduledPostRow[]> {
    const posts = await this.schedulerModel.list(botId);
    return posts.map(toScheduledPostRow);
  }

  /**
   * Reads module configuration for scheduler.
   */
  private async configFor(
    botId: string,
  ): Promise<{ watermarkText: string; timezoneOffsetMinutes: number }> {
    const row = await this.botModel.getModule(botId, 'scheduler');
    const config = safeJsonObjectParse(row?.configJson, {}, `scheduler:${botId}`);
    return {
      watermarkText: String(config.watermarkText ?? ''),
      timezoneOffsetMinutes: Number(config.timezoneOffsetMinutes ?? 0),
    };
  }

  /**
   * Normalizes a submitted schedule instant to UTC. Naive wall times are
   * interpreted in the bot's IANA timezone (DST-correct, via the tested
   * wallTimeToUtc) when one is configured; the legacy fixed-offset module
   * config applies otherwise, preserving existing deployments' behavior.
   * @param {number} botId - Owning bot id.
   * @param {string} scheduledAt - Submitted ISO-ish timestamp.
   * @returns {Promise<string>} UTC ISO instant.
   */
  private async toUtcInstant(botId: string, scheduledAt: string): Promise<string> {
    if (scheduledAt.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(scheduledAt)) {
      return scheduledAt;
    }
    const parsed = new Date(scheduledAt);
    if (Number.isNaN(parsed.getTime())) return scheduledAt;

    const zone = safeTimeZone(this.settings.getBotSetting(botId, 'timezone'));
    const wallMatch = scheduledAt.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (zone !== 'UTC' && wallMatch) {
      return wallTimeToUtc(
        zone,
        Number(wallMatch[1]),
        Number(wallMatch[2]),
        Number(wallMatch[3]),
        Number(wallMatch[4]),
        Number(wallMatch[5]),
      ).toISOString();
    }

    const config = await this.configFor(botId);
    return new Date(parsed.getTime() - config.timezoneOffsetMinutes * 60_000).toISOString();
  }

  /**
   * Creates scheduled posts. The multi-select target picker submits one or
   * many chat ids (`targetChatId` array or the legacy single value); one
   * ScheduledPost row is created per target so each chat dispatches,
   * retries, and reports independently.
   */
  async create(botId: string, data: Record<string, unknown>): Promise<ScheduledPostRow[]> {
    const scheduledAt = await this.toUtcInstant(
      botId,
      String(data.scheduledAt ?? new Date().toISOString()),
    );

    const targets = normalizeChatTargets(data.targetChatId);
    if (targets.length === 0) {
      throw new BadRequestException('At least one target chat is required');
    }
    const created: ScheduledPostRow[] = [];
    for (const targetChatId of targets) {
      created.push(
        toScheduledPostRow(
          await this.schedulerModel.create({
            botId,
            targetChatId,
            messageText: String(data.messageText ?? ''),
            mediaUrl: (data.mediaUrl as string) || null,
            buttonsJson: data.buttons ? JSON.stringify(data.buttons) : null,
            scheduledAt,
          }),
        ),
      );
    }
    return created;
  }

  /**
   * Updates a pending post (only while pending). Retargeting to multiple
   * chats keeps this row for the first target and clones pending posts for
   * every additional target.
   */
  async update(
    botId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<ScheduledPostRow> {
    const existing = await this.findOne(botId, id);
    const scheduledAt =
      data.scheduledAt !== undefined
        ? await this.toUtcInstant(botId, String(data.scheduledAt))
        : existing.scheduled_at;

    const targets = normalizeChatTargets(
      data.targetChatId !== undefined ? data.targetChatId : existing.target_chat_id,
    );
    const primary = targets[0] ?? String(existing.target_chat_id ?? 0);
    const updated = await this.schedulerModel.update(id, {
      targetChatId: primary,
      messageText:
        data.messageText !== undefined ? String(data.messageText) : existing.message_text,
      mediaUrl:
        data.mediaUrl !== undefined ? (data.mediaUrl as string) || null : existing.media_url,
      buttonsJson: data.buttons ? JSON.stringify(data.buttons) : existing.buttons_json,
      scheduledAt,
    });

    // Fan out additional targets as clones of the updated post.
    for (const extra of targets.slice(1)) {
      await this.schedulerModel.create({
        botId,
        targetChatId: extra,
        messageText: updated.messageText,
        mediaUrl: updated.mediaUrl,
        buttonsJson: updated.buttonsJson,
        scheduledAt: updated.scheduledAt,
      });
    }
    return toScheduledPostRow(updated);
  }

  /**
   * Cancels a scheduled post.
   */
  async remove(botId: string, id: string): Promise<void> {
    await this.findOne(botId, id);
    await this.schedulerModel.delete(id);
  }

  /**
   * Fetches one scheduled post.
   */
  async findOne(botId: string, id: string): Promise<ScheduledPostRow> {
    const row = await this.schedulerModel.findById(botId, id);
    if (!row) throw new NotFoundException(`Scheduled post ${id} not found`);
    return toScheduledPostRow(row);
  }

  /**
   * Dispatches every pending post whose time has arrived.
   */
  private async dispatchDue(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
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
    } finally {
      this.isRunning = false;
    }
  }
}
