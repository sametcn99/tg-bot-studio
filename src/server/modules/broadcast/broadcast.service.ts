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
import { toBroadcastRow } from './broadcast.mapper';
import { type BroadcastRow } from './broadcast.entity';
import { BotModel } from '../../bots/bot.model';
import { SystemSettingsService } from '../../database/system-settings.service';
import { type BotUserEntity } from '../users-crm/bot-user.entity';

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
  winnerBroadcastId?: number;
}

/** Deterministic 0-99 bucket of a telegram id (stable A/B assignment). */
function audienceBucket(telegramId: bigint | number): number {
  const id = telegramId.toString();
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Enterprise broadcast engine. Resolves the target audience, queues the
 * send-out with conservative rate limiting (Telegram 429 protection on top of
 * the grammY auto-retry transformer), and tracks per-broadcast counters.
 * Supports multi-variant A/B experiments: a deterministic test split receives
 * the variants, per-variant click-through is tracked through redirect links,
 * and the winner rolls out to the remaining audience.
 */
@Injectable()
export class BroadcastService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly cancelledBroadcasts = new Set<number>();

  constructor(
    private readonly broadcastModel: BroadcastModel,
    private readonly botModel: BotModel,
    private readonly settings: SystemSettingsService,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Cleans up stale in-flight broadcasts from previous runs on server boot.
   */
  async onModuleInit(): Promise<void> {
    const swept = await this.broadcastModel.sweepInterrupted();
    if (swept > 0) {
      this.logger.warn(`Swept ${swept} stalled broadcast(s) to 'interrupted' status on startup`);
    }
  }

  /**
   * Lists broadcast history for a bot (click counters reconciled first).
   */
  async list(botId: number): Promise<BroadcastRow[]> {
    const broadcasts = await this.broadcastModel.list(botId);
    await this.broadcastModel.syncClickCounts(broadcasts);
    return broadcasts.map(toBroadcastRow);
  }

  /**
   * Creates a broadcast (or an A/B experiment when variants are supplied)
   * and starts the background queue.
   */
  async create(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<BroadcastRow | BroadcastRow[]> {
    const variants = this.parseVariants(data);
    if (variants.length > 1) {
      return this.createExperiment(botId, data, variants);
    }

    const item = await this.broadcastModel.create({
      botId,
      targetType: String(data.targetType ?? 'all'),
      messageText: String(data.messageText ?? ''),
      mediaUrl: (data.mediaUrl as string) || null,
      buttonsJson: data.buttons ? JSON.stringify(data.buttons) : null,
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
    botId: number,
    data: Record<string, unknown>,
    variants: BroadcastVariant[],
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
      });
      const withMeta = await this.broadcastModel.updateStatus(item.id, {
        experimentId,
        variantLabel: variant.label ?? String.fromCharCode(65 + i),
        phase: 'test',
      });
      rows.push(toBroadcastRow(withMeta));
    }

    void this.runExperimentTestPhase(botId, experimentId, data, variants);
    return rows;
  }

  /**
   * Sends each variant to its slice of the deterministic test split.
   */
  private async runExperimentTestPhase(
    botId: number,
    experimentId: string,
    data: Record<string, unknown>,
    variants: BroadcastVariant[],
  ): Promise<void> {
    const audience = await this.resolveAudience(botId, data);
    const testSplit = this.loadExperimentMeta(botId, experimentId);
    if (!testSplit) return;
    const limit = testSplit.testSplitPercent;
    const testerIds = new Set(
      audience.filter((user) => audienceBucket(user.telegram_id) < limit).map((u) => u.telegram_id),
    );

    for (let i = 0; i < variants.length; i++) {
      const broadcastId = (await this.findExperimentRows(botId, experimentId))[i]?.id;
      if (!broadcastId) continue;
      const variantAudience = audience.filter(
        (user) =>
          testerIds.has(user.telegram_id) &&
          audienceBucket(user.telegram_id) % variants.length === i,
      );
      await this.runQueue(botId, broadcastId, data, {
        overrideAudience: variantAudience,
        buttons: variants[i].buttons,
        mediaUrl: variants[i].mediaUrl,
        messageText: variants[i].messageText,
      });
    }
  }

  /**
   * Lists every broadcast row of an experiment, in variant order.
   */
  private async findExperimentRows(botId: number, experimentId: string): Promise<BroadcastRow[]> {
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
    botId: number,
    experimentId: string,
    variantBroadcastId?: number,
  ): Promise<{ winner: BroadcastRow; rollout: BroadcastRow | null }> {
    const rows = await this.findExperimentRows(botId, experimentId);
    const testRows = rows.filter((row) => row.phase === 'test');
    if (testRows.length === 0) {
      throw new NotFoundException(`No test variants found for experiment ${experimentId}`);
    }
    const meta = this.loadExperimentMeta(botId, experimentId);
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
      await this.broadcastModel.syncClickCounts(
        await this.broadcastModel.listByExperiment(botId, experimentId),
      );
      const fresh = await this.findExperimentRows(botId, experimentId);
      const freshTest = fresh.filter((row) => row.phase === 'test');
      winner = [...freshTest].sort((a, b) => this.variantScore(b) - this.variantScore(a))[0];
    }

    meta.phase = 'final';
    meta.winnerBroadcastId = winner.id;
    await this.saveExperimentMeta(botId, meta);

    // Close the losing variants so history shows them as concluded.
    for (const row of testRows) {
      if (row.id !== winner.id && (row.status === 'done' || row.status === 'queued')) {
        await this.broadcastModel.updateStatus(row.id, {
          status: row.status === 'queued' ? 'cancelled' : row.status,
        });
      }
    }

    // Roll the winner out to everyone outside the deterministic test split.
    const firstData = {
      targetType: winner.targetType,
      messageText: winner.messageText,
      mediaUrl: winner.mediaUrl ?? undefined,
      buttons: winner.buttonsJson ? JSON.parse(winner.buttonsJson) : undefined,
    };
    const rolloutItem = await this.broadcastModel.create({
      botId,
      targetType: winner.targetType,
      messageText: winner.messageText,
      mediaUrl: winner.mediaUrl,
      buttonsJson: winner.buttonsJson,
    });
    const rolloutMeta = await this.broadcastModel.updateStatus(rolloutItem.id, {
      experimentId,
      variantLabel: `${winner.variantLabel} (final)`,
      phase: 'final',
    });
    const bot = this.pool.getBot(botId);
    if (bot) {
      void this.runQueue(botId, rolloutItem.id, firstData, {
        audienceFilter: (user) => audienceBucket(user.telegram_id) >= meta.testSplitPercent,
      });
    } else {
      await this.broadcastModel.updateStatus(rolloutItem.id, { status: 'failed' });
    }
    return { winner, rollout: toBroadcastRow(rolloutMeta) };
  }

  /**
   * Click-through-first ranking score for a finished variant.
   */
  private variantScore(row: BroadcastRow): number {
    const delivered = Math.max(1, row.successCount);
    const ctr = row.clicks / delivered;
    const deliveryRate = row.totalRecipients > 0 ? row.successCount / row.totalRecipients : 0;
    return ctr * 1000 + deliveryRate;
  }

  /**
   * Fetches one broadcast.
   */
  async findOne(botId: number, id: number): Promise<BroadcastRow> {
    const item = await this.broadcastModel.findById(botId, id);
    if (!item) throw new NotFoundException(`Broadcast ${id} not found`);
    return toBroadcastRow(item);
  }

  /**
   * Cancels a running or queued broadcast.
   */
  async cancel(botId: number, id: number): Promise<BroadcastRow> {
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
   * Resolves the audience for a target type.
   */
  private async resolveAudience(
    botId: number,
    data: Record<string, unknown>,
  ): Promise<BotUserEntity[]> {
    return this.broadcastModel.resolveAudience(botId, {
      targetType: data.targetType as string,
      language: data.language as string,
      recentDays: data.recentDays as number,
    });
  }

  /**
   * Executes the queued send-out with rate limiting and counter tracking.
   * @param {object} options - Optional overrides used by experiment phases.
   */
  private async runQueue(
    botId: number,
    broadcastId: number,
    data: Record<string, unknown>,
    options: {
      overrideAudience?: BotUserEntity[];
      audienceFilter?: (user: BotUserEntity) => boolean;
      messageText?: string;
      mediaUrl?: string;
      buttons?: BroadcastButton[];
    } = {},
  ): Promise<void> {
    const bot = this.pool.getBot(botId);
    if (!bot) {
      await this.broadcastModel.updateStatus(broadcastId, { status: 'failed' });
      return;
    }

    const moduleRow = await this.botModel.getModule(botId, 'broadcast');
    const config = moduleRow?.configJson
      ? (JSON.parse(moduleRow.configJson) as Record<string, unknown>)
      : {};
    const perSecond = Number(config.rateLimitPerSecond ?? 20);
    const delayMs = Math.max(30, Math.round(1000 / Math.max(1, perSecond)));
    const batchSize = Math.max(1, Number(config.batchSize ?? 30));
    const pauseBetweenBatchesMs = Math.max(0, Number(config.pauseBetweenBatchesMs ?? 0));

    let audience = options.overrideAudience ?? (await this.resolveAudience(botId, data));
    if (options.audienceFilter) {
      audience = audience.filter(options.audienceFilter);
    }
    await this.broadcastModel.updateStatus(broadcastId, {
      status: 'running',
      totalRecipients: audience.length,
    });

    const buttons = options.buttons ?? (data.buttons ? (data.buttons as BroadcastButton[]) : []);
    const trackedButtons = await this.wrapButtonsForTracking(botId, broadcastId, buttons, config);
    const keyboard = new InlineKeyboard();
    for (const button of trackedButtons) {
      keyboard.url(button.text, button.url).row();
    }
    const replyMarkup = buttons.length > 0 ? keyboard : undefined;
    const mediaUrl = options.mediaUrl ?? ((data.mediaUrl as string) || undefined);
    const messageText = options.messageText ?? (data.messageText as string);

    let success = 0;
    let failed = 0;
    let batchCounter = 0;

    for (const recipient of audience) {
      if (this.cancelledBroadcasts.has(broadcastId)) {
        this.cancelledBroadcasts.delete(broadcastId);
        await this.broadcastModel.updateStatus(broadcastId, {
          status: 'cancelled',
          successCount: success,
          failedCount: failed,
        });
        this.logger.log(`Broadcast ${broadcastId} stopped early due to cancellation`);
        return;
      }

      try {
        const mention = recipient.username
          ? `@${recipient.username}`
          : `<a href="tg://user?id=${recipient.telegram_id}">${recipient.first_name ?? recipient.telegram_id}</a>`;
        const text = messageText
          .replace(/\{first_name\}/g, recipient.first_name ?? '')
          .replace(/\{last_name\}/g, recipient.last_name ?? '')
          .replace(/\{username\}/g, recipient.username ?? '')
          .replace(/\{user_id\}/g, String(recipient.telegram_id))
          .replace(/\{mention\}/g, mention);

        const options_: Record<string, unknown> = {
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        };
        if (mediaUrl) {
          await bot.api.sendPhoto(recipient.telegram_id, mediaUrl, {
            caption: text,
            ...options_,
          });
        } else {
          await bot.api.sendMessage(recipient.telegram_id, text, options_);
        }
        success++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Broadcast ${broadcastId} delivery failed for user ${recipient.telegram_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      batchCounter++;
      if (pauseBetweenBatchesMs > 0 && batchCounter % batchSize === 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseBetweenBatchesMs));
      } else {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    await this.broadcastModel.updateStatus(broadcastId, {
      status: 'done',
      successCount: success,
      failedCount: failed,
    });
    this.logger.log(`Broadcast ${broadcastId} finished: ${success} sent, ${failed} failed`);
  }

  /**
   * Rewrites button URLs through the studio redirect endpoint when click
   * tracking is configured (`trackClicks` + `publicBaseUrl`), creating one
   * stable link per broadcast button for CTR measurement.
   */
  private async wrapButtonsForTracking(
    botId: number,
    broadcastId: number,
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
   * Persists experiment metadata in bot_settings.
   */
  private saveExperimentMeta(botId: number, meta: ExperimentMeta): void {
    this.settings.setBotSetting(botId, `ab_experiment_${meta.experimentId}`, JSON.stringify(meta));
  }

  /**
   * Loads experiment metadata from bot_settings.
   */
  private loadExperimentMeta(botId: number, experimentId: string): ExperimentMeta | null {
    const raw = this.settings.getBotSetting(botId, `ab_experiment_${experimentId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ExperimentMeta;
    } catch {
      return null;
    }
  }
}
