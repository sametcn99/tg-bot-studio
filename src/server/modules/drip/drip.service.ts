import { Injectable, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { renderTemplate } from '../../common/utils/template.util';
import { safeJsonParse } from '../../common/utils/json.util';
import { DripModel } from './drip.model';
import { BotUserModel } from '../users-crm/bot-user.model';

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
  id: string;
  bot_id: string;
  name: string;
  steps_json: string;
  is_active: number;
}

/** Advancement ticker interval (30 seconds). */
const TICK_INTERVAL_MS = 30_000;

/** Minimum gap between drip sends (matches the broadcast default pacing). */
const SEND_PACE_MS = 50;

/** Transient failures tolerated before the subscriber is dropped. */
const MAX_TRANSIENT_ATTEMPTS = 5;

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
  private autoSubscribeConfig: Record<string, boolean> = {};

  constructor(
    private readonly dripModel: DripModel,
    private readonly botUserModel: BotUserModel,
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
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Attaches optional auto-subscription on /start.
   */
  register(ctx: ModuleRuntimeContext): void {
    this.autoSubscribeConfig[ctx.botId] = Boolean(ctx.config.subscribeOnStart);
    ctx.bot.command('start', async (update, next) => {
      try {
        if (!this.autoSubscribeConfig[ctx.botId] || !update.from) return;
        const campaign = await this.dripModel.findFirstActive(ctx.botId);
        if (campaign) await this.subscribe(ctx.botId, campaign.id, update.from.id);
      } finally {
        await next();
      }
    });
  }

  /**
   * Lists drip campaigns for a bot with parsed steps.
   */
  async list(botId: string): Promise<Array<Record<string, unknown>>> {
    const campaigns = await this.dripModel.listCampaigns(botId);
    return Promise.all(
      campaigns.map(async (row) => {
        const subscribers = await this.dripModel.countSubscribers(row.id);
        return {
          id: row.id,
          bot_id: row.botId,
          name: row.name,
          steps_json: row.stepsJson,
          is_active: row.isActive,
          botId: row.botId,
          stepsJson: row.stepsJson,
          isActive: row.isActive,
          steps: safeJsonParse<DripStep[]>(row.stepsJson, [], 'drip:steps'),
          subscribers,
        };
      }),
    );
  }

  /**
   * Creates a campaign.
   */
  async create(botId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const created = await this.dripModel.createCampaign({
      botId,
      name: String(data.name ?? 'Untitled campaign'),
      stepsJson: JSON.stringify(data.steps ?? []),
      isActive: data.isActive === false ? 0 : 1,
    });
    return {
      id: created.id,
      bot_id: created.botId,
      name: created.name,
      steps_json: created.stepsJson,
      is_active: created.isActive,
      botId: created.botId,
      stepsJson: created.stepsJson,
      isActive: created.isActive,
      steps: safeJsonParse<DripStep[]>(created.stepsJson, [], 'drip:steps'),
      subscribers: 0,
    };
  }

  /**
   * Updates a campaign.
   */
  async update(
    botId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const existing = await this.dripModel.findCampaignById(id);
    if (!existing || existing.botId !== botId) {
      throw new NotFoundException(`Campaign ${id} not found`);
    }
    const updated = await this.dripModel.updateCampaign(id, {
      name: data.name !== undefined ? String(data.name) : existing.name,
      stepsJson: data.steps ? JSON.stringify(data.steps) : existing.stepsJson,
      isActive: data.isActive === undefined ? existing.isActive : data.isActive ? 1 : 0,
    });
    const subscribers = await this.dripModel.countSubscribers(id);
    return {
      id: updated.id,
      bot_id: updated.botId,
      name: updated.name,
      steps_json: updated.stepsJson,
      is_active: updated.isActive,
      botId: updated.botId,
      stepsJson: updated.stepsJson,
      isActive: updated.isActive,
      steps: safeJsonParse<DripStep[]>(updated.stepsJson, [], 'drip:steps'),
      subscribers,
    };
  }

  /**
   * Deletes a campaign and its subscribers.
   */
  async remove(botId: string, id: string): Promise<void> {
    await this.dripModel.deleteCampaign(id);
  }

  /**
   * Subscribes a user to a campaign, scheduling the first step.
   */
  async subscribe(botId: string, campaignId: string, telegramId: number): Promise<void> {
    const campaign = await this.dripModel.findCampaignById(campaignId);
    if (!campaign) return;
    const steps = safeJsonParse<DripStep[]>(campaign.stepsJson, [], 'drip:steps');
    if (steps.length === 0) return;
    const firstDelay = Number(steps[0]?.delayMinutes ?? 0);
    const nextRunAt = new Date(Date.now() + firstDelay * 60_000).toISOString();
    await this.dripModel.subscribe(botId, campaignId, telegramId, nextRunAt);
  }

  /**
   * Lists campaign subscribers.
   */
  async listSubscribers(botId: string, campaignId: string) {
    return this.dripModel.listSubscribers(botId, campaignId);
  }

  /**
   * Unsubscribes a user from a campaign.
   */
  async unsubscribe(botId: string, campaignId: string, telegramId: number): Promise<void> {
    await this.dripModel.unsubscribe(campaignId, telegramId);
  }

  /**
   * Delivers every due step and schedules the next one. Sends are paced
   * (unlike the old fire-hose) and failures are classified: a 403 means the
   * user blocked the bot or deleted the account (unsubscribe immediately),
   * while transient errors retry with backoff up to a limit instead of
   * silently dropping the whole sequence.
   */
  private async advanceDue(): Promise<void> {
    const now = new Date().toISOString();
    const due = await this.dripModel.findDueSubscribers(now);

    for (const subscriber of due) {
      const campaign = await this.dripModel.findCampaignById(subscriber.campaign_id);
      if (!campaign || !campaign.isActive) {
        await this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
        continue;
      }
      const steps = safeJsonParse<DripStep[]>(campaign.stepsJson, [], 'drip:steps');
      const step = steps[subscriber.current_step];
      if (!step) {
        await this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
        continue;
      }
      const bot = this.pool.getBot(subscriber.bot_id);
      if (!bot) continue;

      try {
        const user = await this.botUserModel.findByTelegramId(
          subscriber.bot_id,
          subscriber.telegram_id,
        );
        const text = renderTemplate(step.text, {
          first_name: user?.firstName ?? '',
          username: user?.username ?? '',
          user_id: subscriber.telegram_id,
          bot_name: bot.botInfo?.first_name ?? '',
          date: new Date().toISOString().slice(0, 10),
        });
        await bot.api.sendMessage(subscriber.telegram_id, text, { parse_mode: 'HTML' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Drip step failed for ${subscriber.telegram_id}: ${message}`);
        if (message.includes('403') || message.toLowerCase().includes('forbidden')) {
          // Bot blocked / account deleted — the sequence is undeliverable.
          await this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
        } else {
          const attempts = await this.dripModel.recordTransientFailure(
            subscriber.campaign_id,
            subscriber.telegram_id,
          );
          if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
            this.logger.warn(
              `Drip subscriber ${subscriber.telegram_id} dropped after ${attempts} transient failures`,
            );
            await this.unsubscribe(
              subscriber.bot_id,
              subscriber.campaign_id,
              subscriber.telegram_id,
            );
          }
        }
        continue;
      }

      const nextIndex = subscriber.current_step + 1;
      const nextStep = steps[nextIndex];
      if (!nextStep) {
        await this.unsubscribe(subscriber.bot_id, subscriber.campaign_id, subscriber.telegram_id);
      } else {
        const nextRunAt = new Date(
          Date.now() + Number(nextStep.delayMinutes) * 60_000,
        ).toISOString();
        await this.dripModel.advanceSubscriber(
          subscriber.campaign_id,
          subscriber.telegram_id,
          nextIndex,
          nextRunAt,
        );
      }

      // Pace the backlog: after downtime, all due subscribers used to fire in
      // one tight sequential burst against Telegram's limits.
      await new Promise((resolve) => setTimeout(resolve, SEND_PACE_MS));
    }
  }
}
