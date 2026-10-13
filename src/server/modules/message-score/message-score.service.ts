import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { renderTemplate } from '../../common/utils/template.util';
import {
  MessageScoreModel,
  toScoreScheduleRow,
  type ScoreScheduleRow,
  type LeaderboardEntryEntity,
} from '../../models/message-score.model';
import { BotModel } from '../../models/bot.model';
import { ChatConnectionModel } from '../../models/chat-connection.model';

export type ScorePeriod = 'daily' | 'weekly' | 'monthly' | 'alltime';
export type ScoreFrequency = 'once' | 'hourly' | 'daily' | 'weekly';
export type ScoreParseMode = 'HTML' | 'Markdown' | 'None';

export { ScoreScheduleRow, LeaderboardEntryEntity as LeaderboardEntryRow };

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

export const DEFAULT_HEADER = '🏆 <b>Most Active Members</b> — {group_name}\n<b>{period_label}</b>';
export const DEFAULT_ROW =
  '{medal} {rank}. {mention} — <b>{score}</b> pts ({messages} msgs, {replies} replies)';
export const DEFAULT_FOOTER = '\n💡 Keep chatting to climb the ranks!';

const TICK_INTERVAL_MS = 30_000;
const ACTIVITY_RETENTION_DAYS = 40;
const MEDALS = ['🥇', '🥈', '🥉'] as const;

const PERIOD_LABELS: Record<ScorePeriod, string> = {
  daily: 'Today',
  weekly: 'Last 7 days',
  monthly: 'Last 30 days',
  alltime: 'All time',
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dayBucket(offsetDays: number): string {
  const date = new Date(Date.now() - offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function computeFirstRun(
  frequency: ScoreFrequency,
  timeOfDay: string,
  dayOfWeek: number,
  runAt?: string,
): string {
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

function computeNextRun(frequency: ScoreFrequency, timeOfDay: string, dayOfWeek: number): string {
  if (frequency === 'hourly') return new Date(Date.now() + 3_600_000).toISOString();
  const [hours, minutes] = /^\d{1,2}:\d{2}$/.test(timeOfDay)
    ? timeOfDay.split(':').map(Number)
    : [18, 0];
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
 * Message Score & Activity Leaderboard service.
 */
@Injectable()
export class MessageScoreService implements OnApplicationShutdown {
  private readonly logger = new Logger(MessageScoreService.name);
  private readonly ticker: ReturnType<typeof setInterval>;
  private lastPruneAt = 0;

  constructor(
    private readonly scoreModel: MessageScoreModel,
    private readonly botModel: BotModel,
    private readonly chatConnectionModel: ChatConnectionModel,
    private readonly pool: BotPoolService,
  ) {
    this.ticker = setInterval(() => {
      void this.dispatchDue().catch((error: Error) =>
        this.logger.error(`Score schedule dispatch failed: ${error.message}`),
      );
    }, TICK_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Records one activity event for a member in a chat.
   */
  recordActivity(
    botId: number,
    chatId: number,
    telegramId: number,
    flags: { reply: boolean; media: boolean },
  ): void {
    void this.scoreModel.recordActivity(botId, String(chatId), telegramId, flags);
  }

  /**
   * Computes the weighted activity leaderboard.
   */
  async leaderboard(
    botId: number,
    chatId: string | undefined,
    period: ScorePeriod,
    limit: number,
    weights?: { message: number; reply: number; media: number },
  ): Promise<LeaderboardEntryEntity[]> {
    const sinceDay =
      period === 'daily'
        ? dayBucket(0)
        : period === 'weekly'
          ? dayBucket(6)
          : period === 'monthly'
            ? dayBucket(29)
            : '0000-01-01';
    const effectiveWeights = weights ?? (await this.weightsFor(botId));
    return this.scoreModel.getLeaderboard(botId, chatId, sinceDay, limit, effectiveWeights);
  }

  /**
   * Renders the leaderboard message exactly as it would be posted.
   */
  renderLeaderboardMessage(
    config: ScoreFormatConfig,
    entries: LeaderboardEntryEntity[],
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
      const rawName = entry.first_name || entry.username || `User ${entry.telegram_id}`;
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

  async preview(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<Array<{ chatId: string; title: string; text: string }>> {
    const config = this.formatFromPayload(data);
    const period = this.periodFromPayload(data);
    const weights = await this.weightsFor(botId);
    const targets = this.targetChatIds(data);
    const results: Array<{ chatId: string; title: string; text: string }> = [];
    for (const chatId of targets) {
      const entries = await this.leaderboard(botId, chatId, period, config.topLimit, weights);
      const title = await this.titleFor(botId, chatId);
      results.push({
        chatId,
        title,
        text: this.renderLeaderboardMessage(config, entries, title, this.botName(botId), period),
      });
    }
    return results;
  }

  async sendNow(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<Array<{ chatId: string; ok: boolean; error?: string }>> {
    const bot = this.pool.getBot(botId);
    if (!bot) throw new BadRequestException('The bot is not running; start it before sending.');
    const config = this.formatFromPayload(data);
    const period = this.periodFromPayload(data);
    const weights = await this.weightsFor(botId);
    const results: Array<{ chatId: string; ok: boolean; error?: string }> = [];
    for (const chatId of this.targetChatIds(data)) {
      const entries = await this.leaderboard(botId, chatId, period, config.topLimit, weights);
      const title = await this.titleFor(botId, chatId);
      const text = this.renderLeaderboardMessage(
        config,
        entries,
        title,
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

  async listSchedules(botId: number): Promise<ScoreScheduleRow[]> {
    const rows = await this.scoreModel.listSchedules(botId);
    return rows.map(toScoreScheduleRow);
  }

  async createSchedule(botId: number, data: Record<string, unknown>): Promise<ScoreScheduleRow> {
    const chatIds = this.targetChatIds(data);
    const frequency = this.frequencyFromPayload(data);
    const timeOfDay = /^\d{1,2}:\d{2}$/.test(String(data.timeOfDay ?? ''))
      ? String(data.timeOfDay)
      : '18:00';
    const dayOfWeek = Math.min(Math.max(Math.trunc(Number(data.dayOfWeek ?? 1)) || 0, 0), 6);
    const config = this.formatFromPayload(data);
    const created = await this.scoreModel.createSchedule({
      botId,
      name: String(data.name ?? '').trim() || 'Activity leaderboard',
      chatIdsJson: JSON.stringify(chatIds),
      period: this.periodFromPayload(data),
      frequency,
      timeOfDay,
      dayOfWeek,
      runAt: computeFirstRun(
        frequency,
        timeOfDay,
        dayOfWeek,
        data.runAt ? String(data.runAt) : undefined,
      ),
      topLimit: config.topLimit,
      headerText: config.headerText,
      rowTemplate: config.rowTemplate,
      footerText: config.footerText,
      parseMode: config.parseMode,
      medals: config.medals ? 1 : 0,
      disableNotification: config.disableNotification ? 1 : 0,
    });
    return toScoreScheduleRow(created);
  }

  async updateSchedule(
    botId: number,
    id: number,
    data: Record<string, unknown>,
  ): Promise<ScoreScheduleRow> {
    const existing = await this.scheduleOrFail(botId, id);
    const frequency =
      data.frequency === undefined
        ? (existing.frequency as ScoreFrequency)
        : this.frequencyFromPayload(data);
    const timeOfDay = /^\d{1,2}:\d{2}$/.test(String(data.timeOfDay ?? ''))
      ? String(data.timeOfDay)
      : (existing.time_of_day ?? '18:00');
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
    const chatIds = Array.isArray(data.chatIds)
      ? this.targetChatIds(data)
      : this.parseChatIds(existing.chat_ids_json);
    let status = existing.status;
    if (data.status === 'done') {
      status = 'done';
    } else if (data.status === 'active' || data.active === true) {
      status = 'active';
    } else if (existing.status === 'done') {
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
    const updated = await this.scoreModel.updateSchedule(id, {
      name: String(data.name ?? '').trim() || existing.name,
      chatIdsJson: JSON.stringify(chatIds),
      period: this.periodFromPayload(data),
      frequency,
      timeOfDay,
      dayOfWeek,
      runAt,
      topLimit: config.topLimit,
      headerText: config.headerText,
      rowTemplate: config.rowTemplate,
      footerText: config.footerText,
      parseMode: config.parseMode,
      medals: config.medals ? 1 : 0,
      disableNotification: config.disableNotification ? 1 : 0,
      status,
    });
    return toScoreScheduleRow(updated);
  }

  async removeSchedule(botId: number, id: number): Promise<void> {
    await this.scheduleOrFail(botId, id);
    await this.scoreModel.deleteSchedule(id);
  }

  async runScheduleNow(botId: number, id: number): Promise<ScoreScheduleRow> {
    const schedule = await this.scheduleOrFail(botId, id);
    if (!this.pool.getBot(botId)) {
      throw new BadRequestException('The bot is not running; start it before dispatching.');
    }
    await this.dispatchSchedule(schedule);
    return this.scheduleOrFail(botId, id);
  }

  private async scheduleOrFail(botId: number, id: number): Promise<ScoreScheduleRow> {
    const row = await this.scoreModel.findScheduleById(botId, id);
    if (!row) throw new NotFoundException(`Score schedule ${id} not found`);
    return toScoreScheduleRow(row);
  }

  private async dispatchDue(): Promise<void> {
    await this.pruneOldActivity();
    const now = new Date().toISOString();
    const due = await this.scoreModel.findDueSchedules(now);
    for (const schedule of due) {
      try {
        await this.dispatchSchedule(toScoreScheduleRow(schedule));
      } catch (error) {
        this.logger.warn(
          `Score schedule ${schedule.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

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
    const weights = await this.weightsFor(schedule.bot_id);
    const chatIds = this.parseChatIds(schedule.chat_ids_json);
    let sent = 0;
    let failure = '';
    for (const chatId of chatIds) {
      const entries = await this.leaderboard(
        schedule.bot_id,
        chatId,
        period,
        config.topLimit,
        weights,
      );
      const title = await this.titleFor(schedule.bot_id, chatId);
      const text = this.renderLeaderboardMessage(
        config,
        entries,
        title,
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
      frequency === 'once'
        ? null
        : computeNextRun(frequency, schedule.time_of_day ?? '18:00', schedule.day_of_week ?? 1);
    await this.scoreModel.updateScheduleDispatch(schedule.id, {
      runAt: nextRun ?? schedule.run_at,
      status: nextRun ? 'active' : 'done',
      lastResult: failure
        ? `Sent to ${sent}/${chatIds.length} chats; last error: ${failure}`
        : `Sent to ${sent}/${chatIds.length} chats`,
    });
  }

  private async pruneOldActivity(): Promise<void> {
    if (Date.now() - this.lastPruneAt < 3_600_000) return;
    this.lastPruneAt = Date.now();
    await this.scoreModel.pruneOldActivity(dayBucket(ACTIVITY_RETENTION_DAYS));
  }

  private sendOptions(config: ScoreFormatConfig): Record<string, unknown> {
    return {
      ...(config.parseMode === 'None' ? {} : { parse_mode: config.parseMode }),
      disable_notification: config.disableNotification,
    };
  }

  private periodFromPayload(data: Record<string, unknown>): ScorePeriod {
    const value = String(data.period ?? 'weekly');
    return value === 'daily' || value === 'monthly' || value === 'alltime' ? value : 'weekly';
  }

  private frequencyFromPayload(data: Record<string, unknown>): ScoreFrequency {
    const value = String(data.frequency ?? 'weekly');
    if (['once', 'hourly', 'daily', 'weekly'].includes(value)) {
      return value as ScoreFrequency;
    }
    throw new BadRequestException(`Unknown frequency: ${value}`);
  }

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

  private parseChatIds(json: string): string[] {
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  }

  private async weightsFor(
    botId: number,
  ): Promise<{ message: number; reply: number; media: number }> {
    const mod = await this.botModel.getModule(botId, 'message-score');
    const config = mod?.configJson ? (JSON.parse(mod.configJson) as Record<string, unknown>) : {};
    return {
      message: Math.max(0, Number(config.messageWeight ?? 1)),
      reply: Math.max(0, Number(config.replyWeight ?? 1)),
      media: Math.max(0, Number(config.mediaWeight ?? 2)),
    };
  }

  private async titleFor(botId: number, chatId: string): Promise<string> {
    const conn = await this.chatConnectionModel.findByChatId(botId, chatId);
    return conn?.title ?? chatId;
  }

  private botName(botId: number): string {
    return this.pool.getBot(botId)?.botInfo?.first_name ?? '';
  }
}
