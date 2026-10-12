import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { renderTemplate } from '../../common/utils/template.util';

/**
 * Scheduled post row in the `scheduled_posts` table.
 * @interface ScheduledPostRow
 * @property {number} id - Post identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {number | string} target_chat_id - Destination chat id or `@username`.
 * @property {string} message_text - Post body (placeholders allowed).
 * @property {string} [media_url] - Optional photo/video URL.
 * @property {string} [buttons_json] - JSON rows of `{text, url}` buttons.
 * @property {string} scheduled_at - ISO dispatch timestamp.
 * @property {string} status - `pending` | `done` | `failed`.
 */
export interface ScheduledPostRow {
  id: number;
  bot_id: number;
  target_chat_id: number | string;
  message_text: string;
  media_url: string | null;
  buttons_json: string | null;
  scheduled_at: string;
  status: string;
}

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

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
  ) {
    this.ticker = setInterval(() => {
      void this.dispatchDue().catch((error: Error) =>
        this.logger.error(`Dispatch failed: ${error.message}`),
      );
    }, TICK_INTERVAL_MS);
  }

  /**
   * Stops the dispatch ticker on shutdown.
   * @returns {void}
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Lists scheduled posts for a bot.
   * @param {number} botId - Owning bot id.
   * @returns {ScheduledPostRow[]} Newest first.
   */
  list(botId: number): ScheduledPostRow[] {
    return this.db.query<ScheduledPostRow>(
      'SELECT * FROM scheduled_posts WHERE bot_id = ? ORDER BY scheduled_at DESC',
      botId,
    );
  }

  /**
   * Creates a scheduled post.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - targetChatId, messageText, mediaUrl, buttons, scheduledAt.
   * @returns {ScheduledPostRow} Created row.
   */
  create(botId: number, data: Record<string, unknown>): ScheduledPostRow {
    // Connections may reference public channels by @username; numeric ids stay numbers.
    const target = data.targetChatId;
    const result = this.db.run(
      `INSERT INTO scheduled_posts (bot_id, target_chat_id, message_text, media_url, buttons_json, scheduled_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      botId,
      typeof target === 'string' && target.startsWith('@') ? target : Number(target ?? 0),
      String(data.messageText ?? ''),
      (data.mediaUrl as string) || null,
      data.buttons ? JSON.stringify(data.buttons) : null,
      String(data.scheduledAt ?? new Date().toISOString()),
    );
    return this.findOne(botId, Number(result.lastInsertRowid));
  }

  /**
   * Updates a scheduled post (only while pending).
   * @param {number} botId - Owning bot id.
   * @param {number} id - Post identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {ScheduledPostRow} Updated row.
   * @throws {NotFoundException} When the post does not exist.
   */
  update(botId: number, id: number, data: Record<string, unknown>): ScheduledPostRow {
    const existing = this.findOne(botId, id);
    const target = data.targetChatId;
    this.db.run(
      'UPDATE scheduled_posts SET target_chat_id = ?, message_text = ?, media_url = ?, buttons_json = ?, scheduled_at = ? WHERE id = ?',
      typeof target === 'string' && target.startsWith('@')
        ? target
        : Number(target ?? existing.target_chat_id),
      String(data.messageText ?? existing.message_text),
      (data.mediaUrl as string) ?? existing.media_url,
      data.buttons ? JSON.stringify(data.buttons) : existing.buttons_json,
      String(data.scheduledAt ?? existing.scheduled_at),
      id,
    );
    return this.findOne(botId, id);
  }

  /**
   * Cancels a scheduled post.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Post identifier.
   * @returns {void}
   * @throws {NotFoundException} When the post does not exist.
   */
  remove(botId: number, id: number): void {
    this.findOne(botId, id);
    this.db.run('DELETE FROM scheduled_posts WHERE id = ?', id);
  }

  /**
   * Fetches one scheduled post.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Post identifier.
   * @returns {ScheduledPostRow} The post row.
   * @throws {NotFoundException} When not found.
   */
  findOne(botId: number, id: number): ScheduledPostRow {
    const row = this.db.get<ScheduledPostRow>(
      'SELECT * FROM scheduled_posts WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!row) throw new NotFoundException(`Scheduled post ${id} not found`);
    return row;
  }

  /**
   * Dispatches every pending post whose time has arrived.
   * @returns {Promise<void>} Resolves once all due posts were processed.
   */
  private async dispatchDue(): Promise<void> {
    const now = new Date().toISOString();
    const due = this.db.query<ScheduledPostRow>(
      "SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= ?",
      now,
    );
    for (const post of due) {
      const bot = this.pool.getBot(post.bot_id);
      if (!bot) continue; // Bot offline; retry on next tick.
      try {
        const watermark = await this.watermarkFor(post.bot_id);
        const body = renderTemplate(post.message_text, {
          group_name: '',
          bot_name: bot.botInfo?.first_name ?? '',
          date: new Date().toISOString().slice(0, 10),
          time: new Date().toISOString().slice(11, 16),
        });
        const text = watermark ? `${body}\n\n${watermark}` : body;
        const buttons = post.buttons_json
          ? (JSON.parse(post.buttons_json) as Array<{ text: string; url: string }>)
          : [];
        const keyboard = new InlineKeyboard();
        for (const button of buttons) {
          keyboard.url(button.text, button.url).row();
        }
        const options = buttons.length > 0 ? { reply_markup: keyboard } : {};

        if (post.media_url && /\.(mp4|mov|webm)$/i.test(post.media_url)) {
          await bot.api.sendVideo(post.target_chat_id, post.media_url, {
            caption: text,
            parse_mode: 'HTML',
            ...options,
          });
        } else if (post.media_url) {
          await bot.api.sendPhoto(post.target_chat_id, post.media_url, {
            caption: text,
            parse_mode: 'HTML',
            ...options,
          });
        } else {
          await bot.api.sendMessage(post.target_chat_id, text, {
            parse_mode: 'HTML',
            ...options,
          });
        }
        this.db.run("UPDATE scheduled_posts SET status = 'done' WHERE id = ?", post.id);
      } catch (error) {
        this.logger.warn(
          `Scheduled post ${post.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.db.run("UPDATE scheduled_posts SET status = 'failed' WHERE id = ?", post.id);
      }
    }
  }

  /**
   * Reads the watermark branding text from the module configuration.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<string>} Watermark suffix (empty when disabled).
   */
  private async watermarkFor(botId: number): Promise<string> {
    const row = this.db.get<{ config_json: string | null }>(
      "SELECT config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'scheduler'",
      botId,
    );
    const config = row?.config_json ? (JSON.parse(row.config_json) as Record<string, unknown>) : {};
    return String(config.watermarkText ?? '');
  }
}
