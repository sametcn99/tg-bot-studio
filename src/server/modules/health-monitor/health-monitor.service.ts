import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { HealthModel } from './health.model';
import { BotModel } from '../../bots/bot.model';
import { SystemSettingsService } from '../../database/system-settings.service';
import { LiveEventsService } from '../../common/live/live-events.service';

/** Alert settings for one bot. */
export interface HealthAlertSettings {
  enabled: boolean;
  /** Telegram chat id receiving the alerts (group, channel, or private). */
  alertChatId: string;
}

/** Runtime status remembered between sweeps. */
type SweepStatus = 'active' | 'starting' | 'failed' | 'stopped' | 'inactive' | 'retrying';

/**
 * Bot health monitor: periodically reconciles every active bot's runtime
 * status, records state transitions as health events, and pushes Telegram
 * alerts to a configured chat when a bot fails, starts recovering, or
 * recovers.
 */
@Injectable()
export class HealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthMonitorService.name);
  private readonly lastStatus = new Map<number, SweepStatus>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  /**
   * @param {BotModel} botModel - Bot rows and existence checks.
   * @param {BotPoolService} pool - Runtime status source.
   * @param {HealthModel} healthModel - Health event persistence.
   * @param {SystemSettingsService} settings - Per-bot alert settings.
   * @param {LiveEventsService} live - Live change bus for SSE pings.
   */
  constructor(
    private readonly botModel: BotModel,
    private readonly pool: BotPoolService,
    private readonly healthModel: HealthModel,
    private readonly settings: SystemSettingsService,
    private readonly live: LiveEventsService,
  ) {
    this.sweepTimer = setInterval(() => void this.sweep(), 60_000);
  }

  /**
   * Runs the first sweep once the app finished booting (pool populated).
   * @returns {Promise<void>} Resolves after the initial sweep.
   */
  async onModuleInit(): Promise<void> {
    await this.sweep();
  }

  /**
   * Stops the sweeper.
   * @returns {void}
   */
  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  /**
   * Reconciles runtime statuses, records transitions, and dispatches alerts.
   * @returns {Promise<void>} Resolves after one full sweep.
   */
  async sweep(): Promise<void> {
    try {
      const bots = await this.botModel.findAll();
      for (const bot of bots) {
        const status = this.pool.getStatus(bot.id, bot.isActive === 1);
        const previous = this.lastStatus.get(bot.id);
        this.lastStatus.set(bot.id, status);
        if (previous === undefined || previous === status) continue;

        if (status === 'failed') {
          await this.recordAndNotify(
            bot.id,
            bot.name,
            'failed',
            'Bot polling failed',
            `Poller gave up after repeated crashes. ${this.pool.getRuntimeInfo(bot.id).lastError ?? ''}`.trim(),
          );
        } else if (status === 'retrying') {
          await this.recordAndNotify(
            bot.id,
            bot.name,
            'recovering',
            'Bot is recovering',
            'Poller crashed and auto-restart is in progress.',
          );
        } else if (status === 'active' && (previous === 'failed' || previous === 'retrying')) {
          await this.recordAndNotify(
            bot.id,
            bot.name,
            'recovered',
            'Bot recovered',
            'Polling is healthy again.',
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Health sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reads alert settings of a bot (disabled until configured).
   * @param {number} botId - Owning bot id.
   * @returns {Promise<HealthAlertSettings>} Effective settings.
   */
  async getSettings(botId: number): Promise<HealthAlertSettings> {
    return {
      enabled: this.settings.getBotSetting(botId, 'healthAlertsEnabled') === '1',
      alertChatId: this.settings.getBotSetting(botId, 'healthAlertChatId') ?? '',
    };
  }

  /**
   * Updates alert settings of a bot.
   * @param {number} botId - Owning bot id.
   * @param {HealthAlertSettings} body - Patch payload.
   * @returns {Promise<HealthAlertSettings>} Effective settings after the update.
   */
  async updateSettings(botId: number, body: HealthAlertSettings): Promise<HealthAlertSettings> {
    const chatId = String(body.alertChatId ?? '').trim();
    if (chatId && !/^-?\d+$/.test(chatId)) {
      throw new Error('alertChatId must be a numeric Telegram chat id');
    }
    this.settings.setBotSetting(botId, 'healthAlertsEnabled', body.enabled ? '1' : '0');
    this.settings.setBotSetting(botId, 'healthAlertChatId', chatId);
    return this.getSettings(botId);
  }

  /**
   * Sends a test alert through the bot to verify delivery.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<{delivered: boolean; detail: string}>} Delivery outcome.
   */
  async sendTestAlert(botId: number): Promise<{ delivered: boolean; detail: string }> {
    const config = await this.getSettings(botId);
    if (!config.alertChatId) {
      return { delivered: false, detail: 'No alert chat configured yet.' };
    }
    const delivered = await this.deliver(
      botId,
      config.alertChatId,
      '✅ Test alert from Telegram Bot Studio health monitor. If you can read this, alerting works.',
    );
    return {
      delivered,
      detail: delivered ? 'Test alert delivered.' : 'Delivery failed — check the bot chat access.',
    };
  }

  /**
   * Lists recent health events.
   * @param {number} [botId] - Optional bot filter.
   * @returns {Promise<object[]>} Newest events first.
   */
  async listEvents(botId?: number) {
    const events = await this.healthModel.listRecent(botId, 50);
    return events.map((event) => ({
      id: event.id,
      botId: event.botId,
      level: event.level,
      reason: event.reason,
      message: event.message,
      notified: event.notified === 1,
      createdAt: event.createdAt,
    }));
  }

  /**
   * Persists a health event and, when alerting is enabled, pushes a
   * Telegram message to the configured chat.
   */
  private async recordAndNotify(
    botId: number,
    botName: string,
    level: 'failed' | 'recovering' | 'recovered',
    title: string,
    detail: string,
  ): Promise<void> {
    const config = await this.getSettings(botId);
    let notified = 0;
    if (config.enabled && config.alertChatId) {
      const emoji = level === 'failed' ? '🚨' : level === 'recovering' ? '⚠️' : '✅';
      notified = (await this.deliver(
        botId,
        config.alertChatId,
        `${emoji} ${title}: ${botName}\n${detail}`,
      ))
        ? 1
        : 0;
    }
    await this.healthModel.create({
      botId,
      level,
      reason: null,
      message: `${title}: ${detail}`,
      notified,
    });
    this.live.emit('health', botId);
    this.logger.log(`Health event (${level}) for bot ${botId}: ${title}`);
  }

  /**
   * Sends one alert message using the bot's own API instance.
   * @returns {Promise<boolean>} True when delivered.
   */
  private async deliver(botId: number, chatId: string, text: string): Promise<boolean> {
    const bot = this.pool.getBot(botId);
    if (!bot) return false;
    try {
      await bot.api.sendMessage(chatId, text);
      return true;
    } catch (error) {
      this.logger.warn(
        `Alert delivery failed for bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
