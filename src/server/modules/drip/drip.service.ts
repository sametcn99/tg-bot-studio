import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { renderTemplate } from '../../common/utils/template.util';

/**
 * Drip step definition inside `steps_json`.
 * @interface DripStep
 * @property {number} delayMinutes - Minutes after the previous step.
 * @property {string} text - Message body (placeholders allowed).
 */
export interface DripStep {
  delayMinutes: number;
  text: string;
}

/**
 * Drip campaign row in the `drip_campaigns` table.
 * @interface DripCampaignRow
 * @property {number} id - Campaign identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} name - Campaign name.
 * @property {string} steps_json - JSON array of {@link DripStep}.
 * @property {number} is_active - Enabled flag.
 */
export interface DripCampaignRow {
  id: number;
  bot_id: number;
  name: string;
  steps_json: string;
  is_active: number;
}

/** Advancement ticker interval (30 seconds). */
const TICK_INTERVAL_MS = 30_000;

/**
 * Drip Marketing Sequences: campaign CRUD, subscriber management, and the
 * timed advancement ticker that delivers each next step.
 */
@Injectable()
export class DripService extends BotModuleHandler implements OnApplicationShutdown {
  /** Registry key of the module. */
  readonly moduleKey = 'drip';

  private readonly logger = new Logger(DripService.name);
  private readonly ticker: ReturnType<typeof setInterval>;
  private autoSubscribeConfig: Record<number, boolean> = {};

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
    this.ticker = setInterval(() => {
      void this.advanceDue().catch((error: Error) =>
        this.logger.error(`Drip advance failed: ${error.message}`),
      );
    }, TICK_INTERVAL_MS);
  }

  /**
   * Stops the advancement ticker on shutdown.
   * @returns {void}
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Attaches optional auto-subscription on /start.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    this.autoSubscribeConfig[ctx.botId] = Boolean(ctx.config.subscribeOnStart);
    ctx.bot.command('start', (update) => {
      if (!this.autoSubscribeConfig[ctx.botId] || !update.from) return;
      const campaign = this.db.get<DripCampaignRow>(
        'SELECT * FROM drip_campaigns WHERE bot_id = ? AND is_active = 1 ORDER BY id LIMIT 1',
        ctx.botId,
      );
      if (campaign) this.subscribe(ctx.botId, campaign.id, update.from.id);
    });
  }

  /**
   * Lists drip campaigns for a bot with parsed steps.
   * @param {number} botId - Owning bot id.
   * @returns {Array<object>} Campaigns with decoded steps and subscriber counts.
   */
  list(botId: number): Array<Record<string, unknown>> {
    const rows = this.db.query<DripCampaignRow>(
      'SELECT * FROM drip_campaigns WHERE bot_id = ? ORDER BY id',
      botId,
    );
    return rows.map((row) => {
      const subscribers =
        this.db.get<{ count: number }>(
          'SELECT COUNT(*) as count FROM drip_subscribers WHERE campaign_id = ?',
          row.id,
        )?.count ?? 0;
      return {
        ...row,
        steps: JSON.parse(row.steps_json) as DripStep[],
        subscribers,
      };
    });
  }

  /**
   * Creates a campaign.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - name, steps, isActive.
   * @returns {object} Created campaign with decoded steps.
   */
  create(botId: number, data: Record<string, unknown>): Record<string, unknown> {
    const result = this.db.run(
      'INSERT INTO drip_campaigns (bot_id, name, steps_json, is_active) VALUES (?, ?, ?, ?)',
      botId,
      String(data.name ?? 'Untitled campaign'),
      JSON.stringify(data.steps ?? []),
      data.isActive === false ? 0 : 1,
    );
    return this.list(botId).find((row) => row.id === Number(result.lastInsertRowid))!;
  }

  /**
   * Updates a campaign.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Campaign identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {object} Updated campaign.
   * @throws {NotFoundException} When the campaign does not exist.
   */
  update(botId: number, id: number, data: Record<string, unknown>): Record<string, unknown> {
    const existing = this.db.get<DripCampaignRow>(
      'SELECT * FROM drip_campaigns WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!existing) throw new NotFoundException(`Campaign ${id} not found`);
    this.db.run(
      'UPDATE drip_campaigns SET name = ?, steps_json = ?, is_active = ? WHERE id = ?',
      String(data.name ?? existing.name),
      data.steps ? JSON.stringify(data.steps) : existing.steps_json,
      data.isActive === undefined ? existing.is_active : data.isActive ? 1 : 0,
      id,
    );
    return this.list(botId).find((row) => row.id === id)!;
  }

  /**
   * Deletes a campaign and its subscribers.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Campaign identifier.
   * @returns {void}
   */
  remove(botId: number, id: number): void {
    this.db.run('DELETE FROM drip_subscribers WHERE campaign_id = ?', id);
    this.db.run('DELETE FROM drip_campaigns WHERE bot_id = ? AND id = ?', botId, id);
  }

  /**
   * Subscribes a user to a campaign, scheduling the first step.
   * @param {number} botId - Owning bot id.
   * @param {number} campaignId - Campaign identifier.
   * @param {number} telegramId - Subscriber Telegram id.
   * @returns {void}
   */
  subscribe(botId: number, campaignId: number, telegramId: number): void {
    const campaign = this.db.get<DripCampaignRow>(
      'SELECT * FROM drip_campaigns WHERE id = ?',
      campaignId,
    );
    if (!campaign) return;
    const steps = JSON.parse(campaign.steps_json) as DripStep[];
    if (steps.length === 0) return;
    const firstDelay = Number(steps[0]?.delayMinutes ?? 0);
    this.db.run(
      `INSERT INTO drip_subscribers (bot_id, campaign_id, telegram_id, current_step, next_run_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(campaign_id, telegram_id) DO UPDATE SET current_step = 0, next_run_at = excluded.next_run_at`,
      botId,
      campaignId,
      telegramId,
      new Date(Date.now() + firstDelay * 60_000).toISOString(),
    );
  }

  /**
   * Lists campaign subscribers.
   * @param {number} botId - Owning bot id.
   * @param {number} campaignId - Campaign identifier.
   * @returns {object[]} Subscriber rows.
   */
  listSubscribers(botId: number, campaignId: number): Array<Record<string, unknown>> {
    return this.db.query(
      'SELECT * FROM drip_subscribers WHERE bot_id = ? AND campaign_id = ?',
      botId,
      campaignId,
    );
  }

  /**
   * Unsubscribes a user from a campaign.
   * @param {number} botId - Owning bot id.
   * @param {number} campaignId - Campaign identifier.
   * @param {number} telegramId - Subscriber Telegram id.
   * @returns {void}
   */
  unsubscribe(botId: number, campaignId: number, telegramId: number): void {
    this.db.run(
      'DELETE FROM drip_subscribers WHERE campaign_id = ? AND telegram_id = ?',
      campaignId,
      telegramId,
    );
  }

  /**
   * Delivers every due step and schedules the next one.
   * @returns {Promise<void>} Resolves once all due steps were processed.
   */
  private async advanceDue(): Promise<void> {
    const now = new Date().toISOString();
    const due = this.db.query<{
      bot_id: number;
      campaign_id: number;
      telegram_id: number;
      current_step: number;
    }>("SELECT * FROM drip_subscribers WHERE next_run_at IS NOT NULL AND next_run_at <= ?", now);

    for (const subscriber of due) {
      const campaign = this.db.get<DripCampaignRow>(
        'SELECT * FROM drip_campaigns WHERE id = ? AND is_active = 1',
        subscriber.campaign_id,
      );
      if (!campaign) {
        this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
        continue;
      }
      const steps = JSON.parse(campaign.steps_json) as DripStep[];
      const step = steps[subscriber.current_step];
      if (!step) {
        this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
        continue;
      }
      const bot = this.pool.getBot(subscriber.bot_id);
      if (!bot) continue;

      try {
        const user = this.db.get<{ first_name: string | null; username: string | null }>(
          'SELECT first_name, username FROM bot_users WHERE bot_id = ? AND telegram_id = ?',
          subscriber.bot_id,
          subscriber.telegram_id,
        );
        const text = renderTemplate(step.text, {
          first_name: user?.first_name ?? '',
          username: user?.username ?? '',
          user_id: subscriber.telegram_id,
          bot_name: bot.botInfo?.first_name ?? '',
          date: new Date().toISOString().slice(0, 10),
        });
        await bot.api.sendMessage(subscriber.telegram_id, text, { parse_mode: 'HTML' });
      } catch (error) {
        this.logger.warn(
          `Drip step failed for ${subscriber.telegram_id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
        continue;
      }

      const nextIndex = subscriber.current_step + 1;
      const nextStep = steps[nextIndex];
      if (!nextStep) {
        this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
      } else {
        this.db.run(
          'UPDATE drip_subscribers SET current_step = ?, next_run_at = ? WHERE campaign_id = ? AND telegram_id = ?',
          nextIndex,
          new Date(Date.now() + Number(nextStep.delayMinutes) * 60_000).toISOString(),
          subscriber.campaign_id,
          subscriber.telegram_id,
        );
      }
    }
  }
}
