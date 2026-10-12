import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import type { BotUserRow } from '../../bot-engine/engine-helpers.service';

/**
 * Broadcast row in the `broadcasts` table.
 * @interface BroadcastRow
 * @property {number} id - Broadcast identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} target_type - `all` | `language` | `recent`.
 * @property {string} message_text - Message body (placeholders allowed).
 * @property {string} [media_url] - Optional photo or video URL.
 * @property {string} [buttons_json] - JSON rows of `{text, url}` buttons.
 * @property {number} total_recipients - Resolved audience size.
 * @property {number} success_count - Delivered messages.
 * @property {number} failed_count - Failed deliveries.
 * @property {string} status - `queued` | `running` | `done` | `failed`.
 * @property {string} created_at - ISO creation timestamp.
 */
export interface BroadcastRow {
  id: number;
  bot_id: number;
  target_type: string;
  message_text: string;
  media_url: string | null;
  buttons_json: string | null;
  total_recipients: number;
  success_count: number;
  failed_count: number;
  status: string;
  created_at: string | null;
}

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
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Lists broadcast history for a bot.
   * @param {number} botId - Owning bot id.
   * @returns {BroadcastRow[]} Newest first.
   */
  list(botId: number): BroadcastRow[] {
    return this.db.query<BroadcastRow>(
      'SELECT * FROM broadcasts WHERE bot_id = ? ORDER BY id DESC',
      botId,
    );
  }

  /**
   * Creates a broadcast and starts the background queue.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - targetType, language, recentDays,
   * messageText, mediaUrl, buttons.
   * @returns {BroadcastRow} The queued broadcast row.
   */
  create(botId: number, data: Record<string, unknown>): BroadcastRow {
    const result = this.db.run(
      `INSERT INTO broadcasts (bot_id, target_type, message_text, media_url, buttons_json, total_recipients, success_count, failed_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'queued', ?)`,
      botId,
      String(data.targetType ?? 'all'),
      String(data.messageText ?? ''),
      (data.mediaUrl as string) || null,
      data.buttons ? JSON.stringify(data.buttons) : null,
      new Date().toISOString(),
    );
    const row = this.findOne(botId, Number(result.lastInsertRowid));
    void this.runQueue(botId, row.id, data);
    return row;
  }

  /**
   * Fetches one broadcast.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Broadcast identifier.
   * @returns {BroadcastRow} The broadcast row.
   * @throws {NotFoundException} When not found.
   */
  findOne(botId: number, id: number): BroadcastRow {
    const row = this.db.get<BroadcastRow>(
      'SELECT * FROM broadcasts WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!row) throw new NotFoundException(`Broadcast ${id} not found`);
    return row;
  }

  /**
   * Resolves the audience for a target type.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - Filter parameters.
   * @returns {BotUserRow[]} Target subscribers.
   */
  private resolveAudience(botId: number, data: Record<string, unknown>): BotUserRow[] {
    const targetType = String(data.targetType ?? 'all');
    if (targetType === 'language') {
      return this.db.query<BotUserRow>(
        'SELECT * FROM bot_users WHERE bot_id = ? AND language_code = ?',
        botId,
        String(data.language ?? 'en'),
      );
    }
    if (targetType === 'recent') {
      const days = Number(data.recentDays ?? 7);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      return this.db.query<BotUserRow>(
        'SELECT * FROM bot_users WHERE bot_id = ? AND last_seen_at >= ?',
        botId,
        since,
      );
    }
    return this.db.query<BotUserRow>('SELECT * FROM bot_users WHERE bot_id = ?', botId);
  }

  /**
   * Executes the queued send-out with rate limiting and counter tracking.
   * @param {number} botId - Owning bot id.
   * @param {number} broadcastId - Broadcast identifier.
   * @param {Record<string, unknown>} data - Filter and content parameters.
   * @returns {Promise<void>} Resolves when the queue drains.
   */
  private async runQueue(
    botId: number,
    broadcastId: number,
    data: Record<string, unknown>,
  ): Promise<void> {
    const bot = this.pool.getBot(botId);
    if (!bot) {
      this.db.run("UPDATE broadcasts SET status = 'failed' WHERE id = ?", broadcastId);
      return;
    }
    const moduleRow = this.db.get<{ is_enabled: number; config_json: string | null }>(
      "SELECT is_enabled, config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'broadcast'",
      botId,
    );
    const config = moduleRow?.config_json ? (JSON.parse(moduleRow.config_json) as Record<string, unknown>) : {};
    const perSecond = Number(config.rateLimitPerSecond ?? 20);
    const delayMs = Math.max(30, Math.round(1000 / Math.max(1, perSecond)));

    const audience = this.resolveAudience(botId, data);
    this.db.run(
      "UPDATE broadcasts SET status = 'running', total_recipients = ? WHERE id = ?",
      audience.length,
      broadcastId,
    );

    const buttons: BroadcastButton[] = data.buttons
      ? (data.buttons as BroadcastButton[])
      : [];
    const keyboard = new InlineKeyboard();
    for (const button of buttons) {
      keyboard.url(button.text, button.url).row();
    }
    const replyMarkup = buttons.length > 0 ? keyboard : undefined;
    const mediaUrl = (data.mediaUrl as string) || undefined;

    let success = 0;
    let failed = 0;
    for (const recipient of audience) {
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
      } catch {
        failed++;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    this.db.run(
      "UPDATE broadcasts SET status = 'done', success_count = ?, failed_count = ? WHERE id = ?",
      success,
      failed,
      broadcastId,
    );
    this.logger.log(`Broadcast ${broadcastId} finished: ${success} sent, ${failed} failed`);
  }
}
