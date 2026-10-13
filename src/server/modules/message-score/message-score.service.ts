import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { renderTemplate } from '../../common/utils/template.util';

/** Leaderboard period buckets. */
export type ScorePeriod = 'daily' | 'weekly' | 'monthly' | 'alltime';

/** Posting frequency for scheduled leaderboard messages. */
export type ScoreFrequency = 'once' | 'hourly' | 'daily' | 'weekly';

/** Parse mode accepted by the Telegram send APIs. */
export type ScoreParseMode = 'HTML' | 'Markdown' | 'None';

/**
 * Scheduled leaderboard posting row in the `score_schedules` table.
 * @interface ScoreScheduleRow
 * @property {number} id - Schedule identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} name - Display name.
 * @property {string} chat_ids_json - JSON array of target chat ids.
 * @property {string} period - Leaderboard period (daily/weekly/monthly/alltime).
 * @property {string} frequency - Recurrence (once/hourly/daily/weekly).
 * @property {string} time_of_day - HH:mm UTC dispatch time for daily/weekly.
 * @property {number} day_of_week - 0 (Sun) to 6 (Sat) for weekly frequency.
 * @property {string} run_at - Next dispatch timestamp (ISO).
 * @property {number} top_limit - Leaderboard size.
 * @property {string} header_text - Message header template.
 * @property {string} row_template - Per-member row template.
 * @property {string} footer_text - Message footer template.
 * @property {string} parse_mode - HTML, Markdown, or None.
 * @property {number} medals - 1 when medal emojis decorate the top three.
 * @property {number} disable_notification - 1 for silent messages.
 * @property {string} status - `active` | `done`.
 * @property {string} last_run_at - Last dispatch timestamp.
 * @property {string} last_result - Human-readable outcome of the last run.
 * @property {string} created_at - Creation timestamp.
 */
export interface ScoreScheduleRow {
  id: number;
  bot_id: number;
  name: string;
  chat_ids_json: string;
  period: string;
  frequency: string;
  time_of_day: string | null;
  day_of_week: number | null;
  run_at: string;
  top_limit: number;
  header_text: string | null;
  row_template: string | null;
  footer_text: string | null;
  parse_mode: string | null;
  medals: number;
  disable_notification: number;
  status: string;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string | null;
}

/**
 * Aggregated activity leaderboard entry.
 * @interface LeaderboardEntryRow
 * @property {number} telegram_id - Member Telegram id.
 * @property {string | null} username - Telegram @username without the @.
 * @property {string | null} first_name - Telegram first name.
 * @property {string | null} last_name - Telegram last name.
 * @property {number} messages - Message count in the period.
 * @property {number} replies - Replies to other members in the period.
 * @property {number} media - Media messages in the period.
 * @property {number} score - Weighted activity score.
 */
export interface LeaderboardEntryRow {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  messages: number;
  replies: number;
  media: number;
  score: number;
}

/** Formatting options shared by preview, send-now, and schedules. */
export interface ScoreFormatConfig {
  topLimit: number;
  headerText: string;
  rowTemplate: string;
  footerText: string;
  parseMode: ScoreParseMode;
  medals: boolean;
  disableNotification: boolean;
}

/** Default header when a schedule/composer leaves it blank. */
export const DEFAULT_HEADER = '🏆 <b>Most Active Members</b> — {group_name}\n<b>{period_label}</b>';

/** Default per-member row template. */
export const DEFAULT_ROW = '{medal} {rank}. {mention} — <b>{score}</b> pts ({messages} msgs, {replies} replies)';

/** Default footer. */
export const DEFAULT_FOOTER = '\n💡 Keep chatting to climb the ranks!';

/** Dispatch interval for the due-schedule ticker (30 seconds). */
const TICK_INTERVAL_MS = 30_000;

/** Retention window for raw daily activity buckets (40 days). */
const ACTIVITY_RETENTION_DAYS = 40;

/** Medal emojis awarded to the first three ranks. */
const MEDALS = ['🥇', '🥈', '🥉'] as const;

/** Human labels per leaderboard period. */
const PERIOD_LABELS: Record<ScorePeriod, string> = {
  daily: 'Today',
  weekly: 'Last 7 days',
  monthly: 'Last 30 days',
  alltime: 'All time',
};

/**
 * Escapes HTML-sensitive characters in member names.
 * @param {string} value - Raw text.
 * @returns {string} HTML-safe text.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Returns the UTC day (YYYY-MM-DD) `offsetDays` before today.
 * @param {number} offsetDays - Days to subtract.
 * @returns {string} Day bucket.
 */
function dayBucket(offsetDays: number): string {
  const date = new Date(Date.now() - offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * Computes the first run timestamp for a recurring configuration (UTC).
 * @param {ScoreFrequency} frequency - Recurrence.
 * @param {string} timeOfDay - HH:mm for daily/weekly.
 * @param {number} dayOfWeek - 0-6 for weekly.
 * @param {string | undefined} runAt - Explicit ISO time for `once`.
 * @returns {string} ISO timestamp of the first dispatch.
 */
function computeFirstRun(frequency: ScoreFrequency, timeOfDay: string, dayOfWeek: number, runAt?: string): string {
  if (frequency === 'once') {
    const parsed = runAt ? new Date(runAt) : new Date();
    return (Number.isNaN(parsed.getTime()) ? new Date() : parsed).toISOString();
  }
  if (frequency === 'hourly') {
    return new Date(Date.now() + 3_600_000).toISOString();
  }
  const [hours, minutes] = /^\d{1,2}:\d{2}$/.test(timeOfDay)
    ? timeOfDay.split(':').map(Number)
    : [18, 0];
  const candidate = new Date();
  candidate.setUTCHours(hours, minutes, 0, 0);
  if (frequency === 'daily') {
    if (candidate.getTime() <= Date.now()) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate.toISOString();
  }
  const target = Math.min(Math.max(Math.trunc(dayOfWeek || 0), 0), 6);
  let delta = (target - candidate.getUTCDay() + 7) % 7;
  if (delta === 0 && candidate.getTime() <= Date.now()) delta = 7;
  candidate.setUTCDate(candidate.getUTCDate() + delta);
  return candidate.toISOString();
}

/**
 * Advances a recurring schedule to its next dispatch time.
 * @param {ScoreFrequency} frequency - Recurrence.
 * @param {string} timeOfDay - HH:mm for daily/weekly.
 * @param {number} dayOfWeek - 0-6 for weekly.
 * @returns {string} ISO timestamp of the next dispatch.
 */
function computeNextRun(frequency: ScoreFrequency, timeOfDay: string, dayOfWeek: number): string {
  if (frequency === 'hourly') return new Date(Date.now() + 3_600_000).toISOString();
  const [hours, minutes] = /^\d{1,2}:\d{2}$/.test(timeOfDay) ? timeOfDay.split(':').map(Number) : [18, 0];
  const candidate = new Date();
  candidate.setUTCHours(hours, minutes, 0, 0);
  if (frequency === 'daily') {
    while (candidate.getTime() <= Date.now()) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate.toISOString();
  }
  const target = Math.min(Math.max(Math.trunc(dayOfWeek || 0), 0), 6);
  do {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  } while (candidate.getUTCDay() !== target || candidate.getTime() <= Date.now());
  return candidate.toISOString();
}

/**
 * Message Score & Activity Leaderboard service. Persists per-chat daily
 * activity buckets, computes weighted scores, renders rich leaderboard
 * messages, and dispatches scheduled postings to one or many target chats.
 */
@Injectable()
export class MessageScoreService implements OnApplicationShutdown {
  private readonly logger = new Logger(MessageScoreService.name);
  private readonly ticker: ReturnType<typeof setInterval>;
  private lastPruneAt = 0;

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
        this.logger.error(`Score schedule dispatch failed: ${error.message}`),
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
   * Records one activity event for a member in a chat.
   * @param {number} botId - Owning bot id.
   * @param {number} chatId - Telegram chat id.
   * @param {number} telegramId - Member Telegram id.
   * @param {{ reply: boolean; media: boolean }} flags - Event shape.
   * @returns {void}
   */
  recordActivity(botId: number, chatId: number, telegramId: number, flags: { reply: boolean; media: boolean }): void {
    const day = new Date().toISOString().slice(0, 10);
    this.db.run(
      `INSERT INTO chat_activity (bot_id, chat_id, telegram_id, day, message_count, reply_count, media_count)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(bot_id, chat_id, telegram_id, day) DO UPDATE SET
         message_count = message_count + 1,
         reply_count = reply_count + excluded.reply_count,
         media_count = media_count + excluded.media_count`,
      botId,
      String(chatId),
      telegramId,
      day,
      flags.reply ? 1 : 0,
      flags.media ? 1 : 0,
    );
  }

  /**
   * Computes the weighted activity leaderboard.
   * @param {number} botId - Owning bot id.
   * @param {string | undefined} chatId - Optional chat filter (numeric id or @username).
   * @param {ScorePeriod} period - Period bucket.
   * @param {number} limit - Maximum rows.
   * @param {{ message: number; reply: number; media: number }} [weights] - Score weights.
   * @returns {LeaderboardEntryRow[]} Entries sorted by score.
   */
  leaderboard(
    botId: number,
    chatId: string | undefined,
    period: ScorePeriod,
    limit: number,
    weights?: { message: number; reply: number; media: number },
  ): LeaderboardEntryRow[] {
    const sinceDay =
      period === 'daily' ? dayBucket(0) : period === 'weekly' ? dayBucket(6) : period === 'monthly' ? dayBucket(29) : '0000-01-01';
    const messageWeight = Math.max(0, Number(weights?.message ?? 1));
    const replyWeight = Math.max(0, Number(weights?.reply ?? 1));
    const mediaWeight = Math.max(0, Number(weights?.media ?? 2));
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
    const chatFilter = chatId ? String(chatId) : undefined;
    const params: Array<string | number> = chatFilter
      ? [messageWeight, replyWeight, mediaWeight, botId, sinceDay, chatFilter, safeLimit]
      : [messageWeight, replyWeight, mediaWeight, botId, sinceDay, safeLimit];
    return this.db.query<LeaderboardEntryRow>(
      `SELECT a.telegram_id,
              u.username, u.first_name, u.last_name,
              SUM(a.message_count) AS messages,
              SUM(a.reply_count) AS replies,
              SUM(a.media_count) AS media,
              SUM(a.message_count * ? + a.reply_count * ? + a.media_count * ?) AS score
       FROM chat_activity a
       LEFT JOIN bot_users u ON u.bot_id = a.bot_id AND u.telegram_id = a.telegram_id
       WHERE a.bot_id = ? AND a.day >= ? ${chatFilter ? 'AND a.chat_id = ?' : ''}
       GROUP BY a.telegram_id
       ORDER BY score DESC, messages DESC
       LIMIT ?`,
      ...params,
    );
  }

  /**
   * Renders the leaderboard message exactly as it would be posted.
   * @param {ScoreFormatConfig} config - Format options.
   * @param {LeaderboardEntryRow[]} entries - Leaderboard entries.
   * @param {string} chatTitle - Target chat title.
   * @param {string} botName - Bot display name.
   * @param {ScorePeriod} period - Period bucket.
   * @returns {string} Rendered message text.
   */
  renderLeaderboardMessage(
    config: ScoreFormatConfig,
    entries: LeaderboardEntryRow[],
    chatTitle: string,
    botName: string,
    period: ScorePeriod,
  ): string {
    const isHtml = config.parseMode === 'HTML';
    const now = new Date();
    const base = {
      group_name: isHtml ? escapeHtml(chatTitle) : chatTitle,
      period_label: PERIOD_LABELS[period] ?? period,
      bot_name: botName,
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 16),
    };
    const parts: string[] = [renderTemplate(config.headerText || DEFAULT_HEADER, base).trimEnd()];

    if (entries.length === 0) {
      parts.push('\n(None yet — no activity recorded for this period.)');
    }
    for (const [index, entry] of entries.entries()) {
      const rank = index + 1;
      const rawName =
        entry.first_name || entry.username || `User ${entry.telegram_id}`;
      const safeName = isHtml ? escapeHtml(rawName) : rawName;
      const mention =
        config.parseMode === 'None'
          ? entry.username
            ? `@${entry.username}`
            : safeName
          : entry.username
            ? `@${entry.username}`
            : config.parseMode === 'HTML'
              ? `<a href="tg://user?id=${entry.telegram_id}">${safeName}</a>`
              : `[${rawName}](tg://user?id=${entry.telegram_id})`;
      const line = renderTemplate(config.rowTemplate || DEFAULT_ROW, {
        ...base,
        rank,
        medal: config.medals && rank <= MEDALS.length ? MEDALS[rank - 1] : '',
        name: safeName,
        username: entry.username ?? '',
        user_id: entry.telegram_id,
        mention,
        score: entry.score,
        messages: entry.messages,
        replies: entry.replies,
        media: entry.media,
      });
      parts.push(line);
    }
    parts.push(renderTemplate(config.footerText || DEFAULT_FOOTER, base).trimEnd());
    return parts.filter((part) => part.length > 0).join('\n');
  }

  /**
   * Normalizes free-form request payloads into strict format options.
   * @param {Record<string, unknown>} data - Raw payload.
   * @returns {ScoreFormatConfig} Validated format options.
   */
  formatFromPayload(data: Record<string, unknown>): ScoreFormatConfig {
    const parseModeRaw = String(data.parseMode ?? 'HTML');
    const parseMode: ScoreParseMode =
      parseModeRaw === 'Markdown' || parseModeRaw === 'None' ? parseModeRaw : 'HTML';
    return {
      topLimit: Math.min(Math.max(Math.trunc(Number(data.topLimit ?? 10)) || 10, 1), 50),
      headerText: String(data.headerText ?? '').trim() || DEFAULT_HEADER,
      rowTemplate: String(data.rowTemplate ?? '').trim() || DEFAULT_ROW,
      footerText: String(data.footerText ?? '').trim() || DEFAULT_FOOTER,
      parseMode,
      medals: data.medals !== false,
      disableNotification: data.disableNotification === true,
    };
  }

  /**
   * Renders the leaderboard preview for each requested chat.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - chatIds, chatId?, period, format fields, weights.
   * @returns {Array<{chatId: string; title: string; text: string}>} Rendered previews.
   */
  preview(
    botId: number,
    data: Record<string, unknown>,
  ): Array<{ chatId: string; title: string; text: string }> {
    const config = this.formatFromPayload(data);
    const period = this.periodFromPayload(data);
    const weights = this.weightsFor(botId);
    const targets = this.targetChatIds(data);
    return targets.map((chatId) => {
      const entries = this.leaderboard(botId, chatId, period, config.topLimit, weights);
      const title = this.titleFor(botId, chatId);
      return {
        chatId,
        title,
        text: this.renderLeaderboardMessage(config, entries, title, this.botName(botId), period),
      };
    });
  }

  /**
   * Sends the leaderboard message to every requested chat right away.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - chatIds, period, format fields, weights.
   * @returns {Promise<Array<{chatId: string; ok: boolean; error?: string}>>} Per-chat results.
   * @throws {BadRequestException} When the bot runtime is offline.
   */
  async sendNow(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<Array<{ chatId: string; ok: boolean; error?: string }>> {
    const bot = this.pool.getBot(botId);
    if (!bot) throw new BadRequestException('The bot is not running; start it before sending.');
    const config = this.formatFromPayload(data);
    const period = this.periodFromPayload(data);
    const weights = this.weightsFor(botId);
    const results: Array<{ chatId: string; ok: boolean; error?: string }> = [];
    for (const chatId of this.targetChatIds(data)) {
      const entries = this.leaderboard(botId, chatId, period, config.topLimit, weights);
      const text = this.renderLeaderboardMessage(
        config,
        entries,
        this.titleFor(botId, chatId),
        this.botName(botId),
        period,
      );
      try {
        await bot.api.sendMessage(chatId, text, this.sendOptions(config));
        results.push({ chatId, ok: true });
      } catch (error) {
        results.push({
          chatId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /**
   * Lists scheduled leaderboard postings.
   * @param {number} botId - Owning bot id.
   * @returns {ScoreScheduleRow[]} Schedules, next dispatch first.
   */
  listSchedules(botId: number): ScoreScheduleRow[] {
    return this.db.query<ScoreScheduleRow>(
      "SELECT * FROM score_schedules WHERE bot_id = ? ORDER BY status = 'active' DESC, run_at ASC",
      botId,
    );
  }

  /**
   * Creates a scheduled leaderboard posting.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - name, chatIds, period, frequency, timeOfDay, dayOfWeek, runAt, format fields.
   * @returns {ScoreScheduleRow} Created schedule.
   * @throws {BadRequestException} When no target chat is selected.
   */
  createSchedule(botId: number, data: Record<string, unknown>): ScoreScheduleRow {
    const chatIds = this.targetChatIds(data);
    const frequency = this.frequencyFromPayload(data);
    const timeOfDay = /^\d{1,2}:\d{2}$/.test(String(data.timeOfDay ?? ''))
      ? String(data.timeOfDay)
      : '18:00';
    const dayOfWeek = Math.min(Math.max(Math.trunc(Number(data.dayOfWeek ?? 1)) || 0, 0), 6);
    const config = this.formatFromPayload(data);
    const result = this.db.run(
      `INSERT INTO score_schedules
         (bot_id, name, chat_ids_json, period, frequency, time_of_day, day_of_week, run_at,
          top_limit, header_text, row_template, footer_text, parse_mode, medals, disable_notification,
          status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      botId,
      String(data.name ?? '').trim() || 'Activity leaderboard',
      JSON.stringify(chatIds),
      this.periodFromPayload(data),
      frequency,
      timeOfDay,
      dayOfWeek,
      computeFirstRun(frequency, timeOfDay, dayOfWeek, data.runAt ? String(data.runAt) : undefined),
      config.topLimit,
      config.headerText,
      config.rowTemplate,
      config.footerText,
      config.parseMode,
      config.medals ? 1 : 0,
      config.disableNotification ? 1 : 0,
      new Date().toISOString(),
    );
    return this.scheduleOrFail(botId, Number(result.lastInsertRowid));
  }

  /**
   * Updates a scheduled leaderboard posting and recomputes its next run.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Schedule identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {ScoreScheduleRow} Updated schedule.
   * @throws {NotFoundException} When the schedule does not exist.
   */
  updateSchedule(botId: number, id: number, data: Record<string, unknown>): ScoreScheduleRow {
    const existing = this.scheduleOrFail(botId, id);
    const frequency = data.frequency === undefined ? (existing.frequency as ScoreFrequency) : this.frequencyFromPayload(data);
    const timeOfDay = /^\d{1,2}:\d{2}$/.test(String(data.timeOfDay ?? ''))
      ? String(data.timeOfDay)
      : existing.time_of_day ?? '18:00';
    const dayOfWeek = Math.min(
      Math.max(Math.trunc(Number(data.dayOfWeek ?? existing.day_of_week ?? 1)) || 0, 0),
      6,
    );
    const config =
      data.topLimit !== undefined ||
      data.headerText !== undefined ||
      data.rowTemplate !== undefined ||
      data.footerText !== undefined ||
      data.parseMode !== undefined ||
      data.medals !== undefined ||
      data.disableNotification !== undefined
        ? this.formatFromPayload({
            topLimit: data.topLimit ?? existing.top_limit,
            headerText: data.headerText ?? existing.header_text,
            rowTemplate: data.rowTemplate ?? existing.row_template,
            footerText: data.footerText ?? existing.footer_text,
            parseMode: data.parseMode ?? existing.parse_mode,
            medals: data.medals ?? Boolean(existing.medals),
            disableNotification: data.disableNotification ?? Boolean(existing.disable_notification),
          })
        : this.formatFromPayload({
            topLimit: existing.top_limit,
            headerText: existing.header_text,
            rowTemplate: existing.row_template,
            footerText: existing.footer_text,
            parseMode: existing.parse_mode,
            medals: Boolean(existing.medals),
            disableNotification: Boolean(existing.disable_notification),
          });
    const chatIds = Array.isArray(data.chatIds) ? this.targetChatIds(data) : this.parseChatIds(existing.chat_ids_json);
    let status = existing.status;
    if (data.status === 'done') {
      status = 'done';
    } else if (data.status === 'active' || data.active === true) {
      status = 'active';
    } else if (existing.status === 'done') {
      // Editing a finished one-off with a future dispatch time revives it.
      status = 'active';
    }
    const runAt =
      frequency === 'once'
        ? data.runAt
          ? new Date(String(data.runAt)).toISOString()
          : existing.run_at
        : computeNextRun(frequency, timeOfDay, dayOfWeek);
    if (status === 'active' && new Date(runAt).getTime() <= Date.now()) {
      status = frequency === 'once' ? 'done' : 'active';
    }
    this.db.run(
      `UPDATE score_schedules SET
         name = ?, chat_ids_json = ?, period = ?, frequency = ?, time_of_day = ?, day_of_week = ?,
         run_at = ?, top_limit = ?, header_text = ?, row_template = ?, footer_text = ?,
         parse_mode = ?, medals = ?, disable_notification = ?, status = ?
       WHERE id = ?`,
      String(data.name ?? '').trim() || existing.name,
      JSON.stringify(chatIds),
      this.periodFromPayload(data),
      frequency,
      timeOfDay,
      dayOfWeek,
      runAt,
      config.topLimit,
      config.headerText,
      config.rowTemplate,
      config.footerText,
      config.parseMode,
      config.medals ? 1 : 0,
      config.disableNotification ? 1 : 0,
      status,
      id,
    );
    return this.scheduleOrFail(botId, id);
  }

  /**
   * Deletes a scheduled leaderboard posting.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Schedule identifier.
   * @returns {void}
   * @throws {NotFoundException} When the schedule does not exist.
   */
  removeSchedule(botId: number, id: number): void {
    this.scheduleOrFail(botId, id);
    this.db.run('DELETE FROM score_schedules WHERE id = ?', id);
  }

  /**
   * Dispatches a scheduled leaderboard immediately, keeping its recurrence.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Schedule identifier.
   * @returns {Promise<ScoreScheduleRow>} Updated schedule row.
   * @throws {NotFoundException} When the schedule does not exist.
   * @throws {BadRequestException} When the bot runtime is offline.
   */
  async runScheduleNow(botId: number, id: number): Promise<ScoreScheduleRow> {
    const schedule = this.scheduleOrFail(botId, id);
    if (!this.pool.getBot(botId)) {
      throw new BadRequestException('The bot is not running; start it before dispatching.');
    }
    await this.dispatchSchedule(schedule);
    return this.scheduleOrFail(botId, id);
  }

  /**
   * Fetches one schedule or throws.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Schedule identifier.
   * @returns {ScoreScheduleRow} The row.
   * @throws {NotFoundException} When not found.
   */
  private scheduleOrFail(botId: number, id: number): ScoreScheduleRow {
    const row = this.db.get<ScoreScheduleRow>(
      'SELECT * FROM score_schedules WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!row) throw new NotFoundException(`Score schedule ${id} not found`);
    return row;
  }

  /**
   * Sends every due scheduled leaderboard. Bots that are offline are retried
   * on the next tick; recurring schedules advance to their next slot.
   * @returns {Promise<void>} Resolves once due schedules were processed.
   */
  private async dispatchDue(): Promise<void> {
    this.pruneOldActivity();
    const now = new Date().toISOString();
    const due = this.db.query<ScoreScheduleRow>(
      "SELECT * FROM score_schedules WHERE status = 'active' AND run_at <= ?",
      now,
    );
    for (const schedule of due) {
      try {
        await this.dispatchSchedule(schedule);
      } catch (error) {
        this.logger.warn(
          `Score schedule ${schedule.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Dispatches one schedule: renders and sends the leaderboard to each
   * target chat, then records the outcome and advances recurrence.
   * @param {ScoreScheduleRow} schedule - Schedule row.
   * @returns {Promise<void>} Resolves once all target chats were attempted.
   */
  private async dispatchSchedule(schedule: ScoreScheduleRow): Promise<void> {
    const bot = this.pool.getBot(schedule.bot_id);
    if (!bot) return;
    const config = this.formatFromPayload({
      topLimit: schedule.top_limit,
      headerText: schedule.header_text,
      rowTemplate: schedule.row_template,
      footerText: schedule.footer_text,
      parseMode: schedule.parse_mode,
      medals: Boolean(schedule.medals),
      disableNotification: Boolean(schedule.disable_notification),
    });
    const period = this.periodFromPayload({ period: schedule.period });
    const weights = this.weightsFor(schedule.bot_id);
    const chatIds = this.parseChatIds(schedule.chat_ids_json);
    let sent = 0;
    let failure = '';
    for (const chatId of chatIds) {
      const entries = this.leaderboard(schedule.bot_id, chatId, period, config.topLimit, weights);
      const text = this.renderLeaderboardMessage(
        config,
        entries,
        this.titleFor(schedule.bot_id, chatId),
        this.botName(schedule.bot_id),
        period,
      );
      try {
        await bot.api.sendMessage(chatId, text, this.sendOptions(config));
        sent += 1;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    const frequency = schedule.frequency as ScoreFrequency;
    const nextRun =
      frequency === 'once' ? null : computeNextRun(frequency, schedule.time_of_day ?? '18:00', schedule.day_of_week ?? 1);
    this.db.run(
      "UPDATE score_schedules SET run_at = ?, status = ?, last_run_at = ?, last_result = ? WHERE id = ?",
      nextRun ?? schedule.run_at,
      nextRun ? 'active' : 'done',
      new Date().toISOString(),
      failure
        ? `Sent to ${sent}/${chatIds.length} chats; last error: ${failure}`
        : `Sent to ${sent}/${chatIds.length} chats`,
      schedule.id,
    );
  }

  /**
   * Deletes raw activity buckets beyond the retention window (hourly).
   * @returns {void}
   */
  private pruneOldActivity(): void {
    if (Date.now() - this.lastPruneAt < 3_600_000) return;
    this.lastPruneAt = Date.now();
    this.db.run('DELETE FROM chat_activity WHERE day < ?', dayBucket(ACTIVITY_RETENTION_DAYS));
  }

  /**
   * Builds Telegram send options from the format config.
   * @param {ScoreFormatConfig} config - Format options.
   * @returns {Record<string, unknown>} grammY send options.
   */
  private sendOptions(config: ScoreFormatConfig): Record<string, unknown> {
    return {
      ...(config.parseMode === 'None' ? {} : { parse_mode: config.parseMode }),
      disable_notification: config.disableNotification,
    };
  }

  /**
   * Normalizes the period from a payload.
   * @param {Record<string, unknown>} data - Raw payload.
   * @returns {ScorePeriod} Valid period.
   */
  private periodFromPayload(data: Record<string, unknown>): ScorePeriod {
    const value = String(data.period ?? 'weekly');
    return value === 'daily' || value === 'monthly' || value === 'alltime' ? value : 'weekly';
  }

  /**
   * Normalizes the frequency from a payload.
   * @param {Record<string, unknown>} data - Raw payload.
   * @returns {ScoreFrequency} Valid frequency.
   * @throws {BadRequestException} When the frequency is unknown.
   */
  private frequencyFromPayload(data: Record<string, unknown>): ScoreFrequency {
    const value = String(data.frequency ?? 'weekly');
    if (['once', 'hourly', 'daily', 'weekly'].includes(value)) {
      return value as ScoreFrequency;
    }
    throw new BadRequestException(`Unknown frequency: ${value}`);
  }

  /**
   * Extracts and normalizes target chat ids from a payload.
   * @param {Record<string, unknown>} data - Raw payload.
   * @returns {string[]} Non-empty chat ids.
   * @throws {BadRequestException} When no chat id is present.
   */
  private targetChatIds(data: Record<string, unknown>): string[] {
    const raw = Array.isArray(data.chatIds)
      ? data.chatIds
      : data.chatId !== undefined && data.chatId !== ''
        ? [data.chatId]
        : [];
    const chatIds = [...new Set(raw.map((entry) => String(entry).trim()).filter(Boolean))];
    if (chatIds.length === 0) {
      throw new BadRequestException('Select at least one target chat.');
    }
    return chatIds;
  }

  /**
   * Parses the stored chat id JSON of a schedule.
   * @param {string} json - Stored JSON array.
   * @returns {string[]} Chat ids.
   */
  private parseChatIds(json: string): string[] {
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Reads the score weights from the module configuration.
   * @param {number} botId - Owning bot id.
   * @returns {{message: number; reply: number; media: number}} Effective weights.
   */
  private weightsFor(botId: number): { message: number; reply: number; media: number } {
    const row = this.db.get<{ config_json: string | null }>(
      "SELECT config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'message-score'",
      botId,
    );
    const config = row?.config_json ? (JSON.parse(row.config_json) as Record<string, unknown>) : {};
    return {
      message: Math.max(0, Number(config.messageWeight ?? 1)),
      reply: Math.max(0, Number(config.replyWeight ?? 1)),
      media: Math.max(0, Number(config.mediaWeight ?? 2)),
    };
  }

  /**
   * Resolves a friendly chat title from the connections address book.
   * @param {number} botId - Owning bot id.
   * @param {string} chatId - Chat id.
   * @returns {string} Title fallback to the chat id.
   */
  private titleFor(botId: number, chatId: string): string {
    const row = this.db.get<{ title: string }>(
      'SELECT title FROM chat_connections WHERE bot_id = ? AND chat_id = ?',
      botId,
      chatId,
    );
    return row?.title ?? chatId;
  }

  /**
   * Resolves the bot display name.
   * @param {number} botId - Owning bot id.
   * @returns {string} Bot first name when the runtime is loaded.
   */
  private botName(botId: number): string {
    return this.pool.getBot(botId)?.botInfo?.first_name ?? '';
  }
}
