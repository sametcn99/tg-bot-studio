import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { BroadcastModel } from './broadcast.model';
import type { AudienceUser } from './broadcast.model';
import { toBroadcastRow } from './broadcast.mapper';
import { type BroadcastRow } from './broadcast.entity';
import { isInTestSplit, variantIndexFor, variantScore } from './broadcast-ab.util';
import { escapeHtml } from '../../common/utils/telegram-text.util';
import { BotModel } from '../../bots/bot.model';
import { SystemSettingsService } from '../../database/system-settings.service';
import { safeJsonObjectParse, safeJsonParse } from '../../common/utils/json.util';

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
 * One A/B variant payload.
 * @interface BroadcastVariant
 * @property {string} [label] - Variant label ("A", "B", ...).
 * @property {string} messageText - Variant message text.
 * @property {string} [mediaUrl] - Optional variant media.
 * @property {BroadcastButton[]} [buttons] - Optional variant buttons.
 */
export interface BroadcastVariant {
  label?: string;
  messageText: string;
  mediaUrl?: string;
  buttons?: BroadcastButton[];
}

/** Persisted experiment metadata (bot_settings key `ab_experiment_<id>`). */
interface ExperimentMeta {
  experimentId: string;
  testSplitPercent: number;
  phase: 'test' | 'final';
  winnerBroadcastId?: string;
}

/** Persisted per-broadcast target filters (language/recent) for resume. */
interface TargetFilter {
  language?: string;
  recentDays?: number;
}

/** How often (in sends) the queue checkpoints progress to the database. */
const PROGRESS_CHECKPOINT_EVERY = 25;

/** How often (in sends) the queue re-reads the live bot instance. */
const BOT_REFETCH_EVERY = 50;

/**
 * Enterprise broadcast engine. Resolves the target audience through a
 * batched, cursor-paginated iterator (never hydrating the whole user table),
 * queues the send-out with conservative rate limiting (Telegram 429
 * protection on top of the grammY auto-retry transformer), checkpoints
 * progress so interrupted runs can resume, and tracks per-broadcast counters.
 * Supports multi-variant A/B experiments: a deterministic test split receives
 * the variants, per-variant click-through is tracked through redirect links,
 * and the winner rolls out to the remaining audience.
 */
@Injectable()
export class BroadcastService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly cancelledBroadcasts = new Set<string>();

  constructor(
    private readonly broadcastModel: BroadcastModel,
    private readonly botModel: BotModel,
    private readonly settings: SystemSettingsService,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Cleans up stale in-flight broadcasts from previous runs on server boot.
   * Interrupted rows keep their checkpoint cursor so operators can resume.
   */
  async onModuleInit(): Promise<void> {
    const swept = await this.broadcastModel.sweepInterrupted();
    if (swept > 0) {
      this.logger.warn(`Swept ${swept} stalled broadcast(s) to 'interrupted' status on startup`);
    }
  }

  /**
   * Lists broadcast history for a bot. Click counts are maintained at the
   * redirect endpoint (counter-on-write), so no read-side reconciliation.
   */
  async list(botId: string): Promise<BroadcastRow[]> {
    const broadcasts = await this.broadcastModel.list(botId);
    return broadcasts.map(toBroadcastRow);
  }

  /**
   * Creates a broadcast (or an A/B experiment when variants are supplied)
   * and starts the background queue.
   */
  async create(
    botId: string,
    data: Record<string, unknown>,
  ): Promise<BroadcastRow | BroadcastRow[]> {
    const variants = this.parseVariants(data);
    const targetFilter = this.parseTargetFilter(data);
    const targetFilterJson =
      targetFilter.language || targetFilter.recentDays ? JSON.stringify(targetFilter) : null;

    if (variants.length > 1) {
      return this.createExperiment(botId, data, variants, targetFilterJson);
    }

    const item = await this.broadcastModel.create({
      botId,
      targetType: String(data.targetType ?? 'all'),
      messageText: String(data.messageText ?? ''),
      mediaUrl: (data.mediaUrl as string) || null,
      buttonsJson: data.buttons ? JSON.stringify(data.buttons) : null,
      targetFilterJson,
    });
    const row = toBroadcastRow(item);
    void this.runQueue(botId, row.id, data);
    return row;
  }

  /**
   * Creates an A/B experiment: one broadcast row per variant in the `test`
   * phase, sharing an experiment id; the deterministic test slice is sent
   * immediately.
   */
  private async createExperiment(
    botId: string,
    data: Record<string, unknown>,
    variants: BroadcastVariant[],
    targetFilterJson: string | null,
  ): Promise<BroadcastRow[]> {
    const experimentId = randomUUID();
    const testSplitPercent = Math.min(50, Math.max(5, Number(data.testSplitPercent ?? 20) || 20));
    const meta: ExperimentMeta = { experimentId, testSplitPercent, phase: 'test' };
    await this.saveExperimentMeta(botId, meta);

    const rows: BroadcastRow[] = [];
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const item = await this.broadcastModel.create({
        botId,
        targetType: String(data.targetType ?? 'all'),
        messageText: variant.messageText,
        mediaUrl: variant.mediaUrl || null,
        buttonsJson: variant.buttons ? JSON.stringify(variant.buttons) : null,
        targetFilterJson,
      });
      const withMeta = await this.broadcastModel.updateStatus(item.id, {
        experimentId,
        variantLabel: variant.label ?? String.fromCharCode(65 + i),
        phase: 'test',
      });
      rows.push(toBroadcastRow(withMeta));
    }

    void this.runExperimentTestPhase(botId, experimentId, data, variants, targetFilterJson);
    return rows;
  }

  /**
   * Sends each variant to its slice of the deterministic test split. The
   * audience is iterated once per variant through the batched generator —
   * no full-table hydration.
   */
  private async runExperimentTestPhase(
    botId: string,
    experimentId: string,
    data: Record<string, unknown>,
    variants: BroadcastVariant[],
    targetFilterJson: string | null,
  ): Promise<void> {
    const meta = await this.loadExperimentMeta(botId, experimentId);
    if (!meta) return;

    const dataFilters = {
      targetType: data.targetType as string | undefined,
      language: data.language as string | undefined,
      recentDays: data.recentDays as number | undefined,
    };
    const audienceSize = await this.broadcastModel.countAudience(botId, dataFilters);
    const testSplitSize = Math.round((audienceSize * meta.testSplitPercent) / 100);

    for (let i = 0; i < variants.length; i++) {
      const broadcastId = (await this.findExperimentRows(botId, experimentId))[i]?.id;
      if (!broadcastId) continue;
      await this.runQueue(botId, broadcastId, data, {
        audienceFilter: (u) =>
          isInTestSplit(u.telegram_id, meta.testSplitPercent) &&
          variantIndexFor(u.telegram_id, variants.length) === i,
        buttons: variants[i].buttons,
        mediaUrl: variants[i].mediaUrl,
        messageText: variants[i].messageText,
        targetFilterJson,
        estimatedTotal: Math.round(testSplitSize / variants.length),
      });
    }
  }

  /**
   * Lists every broadcast row of an experiment, in variant order.
   */
  private async findExperimentRows(botId: string, experimentId: string): Promise<BroadcastRow[]> {
    const rows = await this.broadcastModel.listByExperiment(botId, experimentId);
    return rows.map(toBroadcastRow);
  }

  /**
   * Picks the winning variant of a finished test phase (explicit or by best
   * click-through, tie-broken by delivery rate) and queues the winner to the
   * audience that was not part of the test split.
   * @param {number} botId - Owning bot id.
   * @param {string} experimentId - Experiment group id.
   * @param {number} [variantBroadcastId] - Manual winner override.
   * @returns {Promise<object>} Winner row plus rollout broadcast row.
   */
  async chooseWinner(
    botId: string,
    experimentId: string,
    variantBroadcastId?: string,
  ): Promise<{ winner: BroadcastRow; rollout: BroadcastRow | null }> {
    const rows = await this.findExperimentRows(botId, experimentId);
    const testRows = rows.filter((row) => row.phase === 'test');
    if (testRows.length === 0) {
      throw new NotFoundException(`No test variants found for experiment ${experimentId}`);
    }
    const meta = await this.loadExperimentMeta(botId, experimentId);
    if (!meta) throw new NotFoundException(`Experiment ${experimentId} metadata missing`);
    if (meta.phase === 'final') {
      throw new BadRequestException('This experiment already rolled out its winner');
    }

    let winner: BroadcastRow;
    if (variantBroadcastId) {
      const manual = testRows.find((row) => row.id === variantBroadcastId);
      if (!manual) throw new NotFoundException(`Variant broadcast ${variantBroadcastId} not found`);
      winner = manual;
    } else {
      // Click counters are maintained at the redirect endpoint, so the
      // in-memory rows are already current.
      winner = [...testRows].sort((a, b) => variantScore(b) - variantScore(a))[0];
    }

    meta.phase = 'final';
    meta.winnerBroadcastId = winner.id;
    await this.saveExperimentMeta(botId, meta);

    // Close the still-queued losing variants and create the rollout row in
    // one transaction so a crash cannot split the conclusion across states.
    const rolloutItem = await this.broadcastModel.concludeExperiment(
      botId,
      testRows
        .filter((row) => row.id !== winner.id && row.status === 'queued')
        .map((row) => row.id),
      {
        targetType: winner.targetType,
        messageText: winner.messageText,
        mediaUrl: winner.mediaUrl,
        buttonsJson: winner.buttonsJson,
      },
    );
    const rolloutMeta = await this.broadcastModel.updateStatus(rolloutItem.id, {
      experimentId,
      variantLabel: `${winner.variantLabel ?? 'A'} (final)`,
      phase: 'final',
    });
    const bot = this.pool.getBot(botId);
    if (bot) {
      void this.runQueue(
        botId,
        rolloutItem.id,
        {
          targetType: winner.targetType,
          messageText: winner.messageText,
          mediaUrl: winner.mediaUrl ?? undefined,
          buttons: safeJsonParse<BroadcastButton[]>(winner.buttonsJson, [], 'broadcast:buttons'),
        },
        {
          audienceFilter: (u) => !isInTestSplit(u.telegram_id, meta.testSplitPercent),
          estimatedTotal: Math.round(
            (await this.broadcastModel.countAudience(botId, {
              targetType: winner.targetType,
            })) *
              ((100 - meta.testSplitPercent) / 100),
          ),
        },
      );
    } else {
      await this.broadcastModel.updateStatus(rolloutItem.id, { status: 'failed' });
    }
    return { winner, rollout: toBroadcastRow(rolloutMeta) };
  }

  /**
   * Fetches one broadcast.
   */
  async findOne(botId: string, id: string): Promise<BroadcastRow> {
    const item = await this.broadcastModel.findById(botId, id);
    if (!item) throw new NotFoundException(`Broadcast ${id} not found`);
    return toBroadcastRow(item);
  }

  /**
   * Cancels a running or queued broadcast.
   */
  async cancel(botId: string, id: string): Promise<BroadcastRow> {
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
   * Resumes an interrupted broadcast from its persisted cursor: recipients up
   * to the checkpoint are skipped, the rest are delivered with the original
   * content and target filters.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Interrupted broadcast identifier.
   * @returns {Promise<BroadcastRow>} The row now re-queued for delivery.
   */
  async resume(botId: string, id: string): Promise<BroadcastRow> {
    const item = await this.broadcastModel.findById(botId, id);
    if (!item) throw new NotFoundException(`Broadcast ${id} not found`);
    if (item.status !== 'interrupted') {
      throw new BadRequestException('Only interrupted broadcasts can be resumed');
    }
    const targetFilter = safeJsonObjectParse(item.targetFilterJson, {}) as TargetFilter;
    await this.broadcastModel.updateStatus(id, { status: 'queued' });
    void this.runQueue(
      botId,
      id,
      {
        targetType: item.targetType,
        messageText: item.messageText,
        mediaUrl: item.mediaUrl ?? undefined,
        buttons: safeJsonParse<BroadcastButton[]>(item.buttonsJson, [], 'broadcast:buttons'),
        language: targetFilter.language,
        recentDays: targetFilter.recentDays,
      },
      {
        resumeAfterId: item.sentCursor ? Number(item.sentCursor) : 0,
      },
    );
    return this.findOne(botId, id);
  }

  /**
   * Parses optional A/B variants from the request payload.
   */
  private parseVariants(data: Record<string, unknown>): BroadcastVariant[] {
    if (!Array.isArray(data.variants)) return [];
    const parsed: Array<BroadcastVariant | null> = (data.variants as unknown[]).map(
      (entry): BroadcastVariant | null => {
        const item = entry as Record<string, unknown>;
        const messageText = String(item.messageText ?? '').trim();
        if (!messageText) return null;
        return {
          label: item.label ? String(item.label) : undefined,
          messageText,
          mediaUrl: item.mediaUrl ? String(item.mediaUrl) : undefined,
          buttons: Array.isArray(item.buttons) ? (item.buttons as BroadcastButton[]) : undefined,
        };
      },
    );
    return parsed.filter((v): v is BroadcastVariant => v !== null).slice(0, 3);
  }

  /**
   * Extracts persistable target filters (language/recent) from the payload.
   */
  private parseTargetFilter(data: Record<string, unknown>): TargetFilter {
    const filter: TargetFilter = {};
    if (typeof data.language === 'string' && data.language) filter.language = data.language;
    if (Number.isFinite(Number(data.recentDays)) && Number(data.recentDays) > 0) {
      filter.recentDays = Number(data.recentDays);
    }
    return filter;
  }

  /**
   * Executes the queued send-out: batched audience iteration, rate limiting,
   * progress checkpoints (for live progress + crash resume), periodic live
   * bot re-reads, and cancellation handling without a final-write race.
   * @param {object} options - Optional overrides used by experiment phases and resume.
   */
  private async runQueue(
    botId: string,
    broadcastId: string,
    data: Record<string, unknown>,
    options: {
      audienceFilter?: (user: AudienceUser) => boolean;
      messageText?: string;
      mediaUrl?: string;
      buttons?: BroadcastButton[];
      targetFilterJson?: string | null;
      resumeAfterId?: number;
      estimatedTotal?: number;
    } = {},
  ): Promise<void> {
    try {
      let bot = this.pool.getBot(botId);
      if (!bot) {
        await this.broadcastModel.updateStatus(broadcastId, { status: 'failed' });
        return;
      }

      const moduleRow = await this.botModel.getModule(botId, 'broadcast');
      const config = safeJsonObjectParse(moduleRow?.configJson, {}, 'broadcast:config');
      const perSecond = Number(config.rateLimitPerSecond ?? 20);
      const delayMs = Math.max(30, Math.round(1000 / Math.max(1, perSecond)));
      const batchSize = Math.max(1, Number(config.batchSize ?? 30));
      const pauseBetweenBatchesMs = Math.max(0, Number(config.pauseBetweenBatchesMs ?? 0));

      // Upfront total: database-side COUNT for unfiltered targets (exact);
      // experiment slices pass an estimate (bucket math cannot run in SQL).
      // Counters converge to exact values as the queue progresses.
      const dataFilters = {
        targetType: data.targetType as string | undefined,
        language: data.language as string | undefined,
        recentDays: data.recentDays as number | undefined,
      };
      const total =
        options.estimatedTotal ?? (await this.broadcastModel.countAudience(botId, dataFilters));
      await this.broadcastModel.updateStatus(broadcastId, {
        status: 'running',
        totalRecipients: total,
      });

      const buttons = options.buttons ?? (data.buttons ? (data.buttons as BroadcastButton[]) : []);
      const trackedButtons = await this.wrapButtonsForTracking(botId, broadcastId, buttons, config);
      const keyboard = new InlineKeyboard();
      for (const button of trackedButtons) {
        keyboard.url(button.text, button.url).row();
      }
      const replyMarkup = buttons.length > 0 ? keyboard : undefined;
      const mediaUrl = options.mediaUrl ?? ((data.mediaUrl as string) || undefined);
      const messageText = (options.messageText ?? data.messageText) as string;

      let success = 0;
      let failed = 0;
      let batchCounter = 0;
      let sinceCheckpoint = 0;
      let lastSentId = options.resumeAfterId ?? 0;

      const persistProgress = async (): Promise<void> => {
        sinceCheckpoint = 0;
        await this.broadcastModel
          .updateStatus(broadcastId, {
            successCount: success,
            failedCount: failed,
            sentCursor: lastSentId,
          })
          .catch((error: unknown) => {
            this.logger.warn(
              `Broadcast ${broadcastId} progress checkpoint failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      };

      for await (const recipient of this.broadcastModel.iterateAudience(
        botId,
        dataFilters,
        options.resumeAfterId ?? 0,
      )) {
        if (this.cancelledBroadcasts.has(broadcastId)) {
          this.cancelledBroadcasts.delete(broadcastId);
          await this.broadcastModel.updateStatus(broadcastId, {
            status: 'cancelled',
            successCount: success,
            failedCount: failed,
            sentCursor: lastSentId,
          });
          this.logger.log(`Broadcast ${broadcastId} stopped early due to cancellation`);
          return;
        }

        if (options.audienceFilter && !options.audienceFilter(recipient)) {
          lastSentId = recipient.telegram_id;
          continue;
        }

        try {
          // Periodically re-read the live bot so a token rotation mid-run
          // switches to the fresh instance instead of silently failing.
          if (batchCounter > 0 && batchCounter % BOT_REFETCH_EVERY === 0) {
            const fresh = this.pool.getBot(botId);
            if (fresh) bot = fresh;
          }

          // User-controlled names are escaped: they travel inside a
          // parse_mode=HTML message and must never inject markup.
          const mention = recipient.username
            ? `@${recipient.username}`
            : `<a href="tg://user?id=${recipient.telegram_id}">${escapeHtml(recipient.first_name ?? String(recipient.telegram_id))}</a>`;
          const text = messageText
            .replace(/\{first_name\}/g, escapeHtml(recipient.first_name ?? ''))
            .replace(/\{last_name\}/g, escapeHtml(recipient.last_name ?? ''))
            .replace(/\{username\}/g, escapeHtml(recipient.username ?? ''))
            .replace(/\{user_id\}/g, String(recipient.telegram_id))
            .replace(/\{mention\}/g, mention);

          const sendOptions: Record<string, unknown> = {
            parse_mode: 'HTML',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          };
          if (mediaUrl) {
            await bot.api.sendPhoto(recipient.telegram_id, mediaUrl, {
              caption: text,
              ...sendOptions,
            });
          } else {
            await bot.api.sendMessage(recipient.telegram_id, text, sendOptions);
          }
          success++;
        } catch (err) {
          failed++;
          this.logger.warn(
            `Broadcast ${broadcastId} delivery failed for user ${recipient.telegram_id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        lastSentId = recipient.telegram_id;
        batchCounter++;
        sinceCheckpoint++;
        if (sinceCheckpoint >= PROGRESS_CHECKPOINT_EVERY) {
          await persistProgress();
        }

        if (pauseBetweenBatchesMs > 0 && batchCounter % batchSize === 0) {
          await new Promise((resolve) => setTimeout(resolve, pauseBetweenBatchesMs));
        } else {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      // Guard the final write: a cancel landing between the last loop check
      // and here must not be overwritten with 'done'.
      const current = await this.broadcastModel.findById(botId, broadcastId);
      if (current?.status === 'cancelled') {
        this.cancelledBroadcasts.delete(broadcastId);
        await this.broadcastModel.updateStatus(broadcastId, {
          successCount: success,
          failedCount: failed,
          sentCursor: lastSentId,
        });
        return;
      }

      await this.broadcastModel.updateStatus(broadcastId, {
        status: 'done',
        successCount: success,
        failedCount: failed,
        totalRecipients: success + failed,
        sentCursor: lastSentId,
      });
      this.logger.log(`Broadcast ${broadcastId} finished: ${success} sent, ${failed} failed`);
    } catch (error) {
      // A crash inside the queue (audience query, tracking wrap, …) must
      // strand the row as failed with counters — never stuck in 'running'.
      this.logger.error(
        `Broadcast ${broadcastId} queue crashed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      await this.broadcastModel
        .updateStatus(broadcastId, { status: 'failed' })
        .catch(() => undefined);
    } finally {
      this.cancelledBroadcasts.delete(broadcastId);
    }
  }

  /**
   * Rewrites button URLs through the studio redirect endpoint when click
   * tracking is configured (`trackClicks` + `publicBaseUrl`), creating one
   * stable link per broadcast button for CTR measurement.
   */
  private async wrapButtonsForTracking(
    botId: string,
    broadcastId: string,
    buttons: BroadcastButton[],
    config: Record<string, unknown>,
  ): Promise<BroadcastButton[]> {
    const publicBaseUrl = String(config.publicBaseUrl ?? '').replace(/\/+$/, '');
    if (config.trackClicks !== true || !publicBaseUrl || buttons.length === 0) {
      return buttons;
    }
    const tracked: BroadcastButton[] = [];
    for (let i = 0; i < buttons.length; i++) {
      const linkId = await this.broadcastModel.createTrackingLink(
        botId,
        broadcastId,
        i,
        buttons[i].url,
      );
      tracked.push({ text: buttons[i].text, url: `${publicBaseUrl}/api/go/${linkId}` });
    }
    return tracked;
  }

  /**
   * Persists experiment metadata in bot_settings (awaited so a failed write
   * surfaces before the experiment continues).
   */
  private async saveExperimentMeta(botId: string, meta: ExperimentMeta): Promise<void> {
    await this.settings.setBotSetting(
      botId,
      `ab_experiment_${meta.experimentId}`,
      JSON.stringify(meta),
    );
  }

  /**
   * Loads experiment metadata from bot_settings.
   */
  private async loadExperimentMeta(
    botId: string,
    experimentId: string,
  ): Promise<ExperimentMeta | null> {
    const raw = this.settings.getBotSetting(botId, `ab_experiment_${experimentId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ExperimentMeta;
    } catch {
      return null;
    }
  }
}
