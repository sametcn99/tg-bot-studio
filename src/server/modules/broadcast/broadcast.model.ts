import { Injectable } from '@nestjs/common';
import type { Broadcast, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';

/**
 * Lean audience member handed to the broadcast queue. Single shape (no
 * duplicated snake/camel copies) to keep per-recipient allocation minimal on
 * large audiences.
 */
export interface AudienceUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
}

/** Shared filter shape for audience queries. */
export interface AudienceFilter {
  targetType?: string;
  language?: string;
  recentDays?: number;
}

const AUDIENCE_BATCH_SIZE = 500;

/**
 * Model managing Broadcast entities and audience queries via Prisma.
 */
@Injectable()
export class BroadcastModel {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Lists broadcasts for a bot newest first.
   */
  async list(botId: number): Promise<Broadcast[]> {
    return this.prisma.broadcast.findMany({
      where: { botId },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * Finds a broadcast by botId and id.
   */
  async findById(botId: number, id: number): Promise<Broadcast | null> {
    return this.prisma.broadcast.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Creates a queued broadcast.
   */
  async create(data: {
    botId: number;
    targetType: string;
    messageText: string;
    mediaUrl?: string | null;
    buttonsJson?: string | null;
    targetFilterJson?: string | null;
  }): Promise<Broadcast> {
    const created = await this.prisma.broadcast.create({
      data: {
        botId: data.botId,
        targetType: data.targetType,
        messageText: data.messageText,
        mediaUrl: data.mediaUrl ?? null,
        buttonsJson: data.buttonsJson ?? null,
        targetFilterJson: data.targetFilterJson ?? null,
        totalRecipients: 0,
        successCount: 0,
        failedCount: 0,
        status: 'queued',
        createdAt: new Date().toISOString(),
      },
    });
    this.live.emit('broadcasts', data.botId);
    return created;
  }

  /**
   * Updates status, counters, cursor, or experiment metadata of a broadcast.
   */
  async updateStatus(
    id: number,
    data: {
      status?: string;
      totalRecipients?: number;
      successCount?: number;
      failedCount?: number;
      sentCursor?: bigint | number | null;
      experimentId?: string;
      variantLabel?: string;
      phase?: string;
    },
  ): Promise<Broadcast> {
    const updated = await this.prisma.broadcast.update({
      where: { id },
      data: {
        ...data,
        sentCursor:
          data.sentCursor === null
            ? null
            : data.sentCursor !== undefined
              ? BigInt(data.sentCursor)
              : undefined,
      },
    });
    this.live.emit('broadcasts', updated.botId);
    return updated;
  }

  /**
   * Lists every broadcast of an experiment group, variant order first.
   */
  async listByExperiment(botId: number, experimentId: string): Promise<Broadcast[]> {
    const rows = await this.prisma.broadcast.findMany({
      where: { botId, experimentId },
      orderBy: { id: 'asc' },
    });
    return rows.sort((a, b) => String(a.variantLabel).localeCompare(String(b.variantLabel)));
  }

  /**
   * Builds the Prisma `where` clause for an audience filter.
   * @param {number} botId - Owning bot id.
   * @param {AudienceFilter} data - Target filters.
   * @returns {Prisma.BotUserWhereInput} Prisma where clause.
   */
  private audienceWhere(botId: number, data: AudienceFilter): Prisma.BotUserWhereInput {
    const targetType = data.targetType ?? 'all';
    if (targetType === 'language') {
      return { botId, languageCode: data.language ?? 'en' };
    }
    if (targetType === 'recent') {
      const days = Number(data.recentDays ?? 7);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      return { botId, lastSeenAt: { gte: since } };
    }
    return { botId };
  }

  /**
   * Counts the audience for a filter with a database-side COUNT — no row
   * hydration. Used for upfront `totalRecipients`.
   */
  async countAudience(botId: number, data: AudienceFilter): Promise<number> {
    return this.prisma.botUser.count({
      where: this.audienceWhere(botId, data),
    });
  }

  /**
   * Iterates the audience in deterministic telegram-id order using cursor
   * pagination, so a million-user broadcast never hydrates the whole table
   * into memory. Each batch is fetched only after the previous one is
   * consumed.
   * @param {number} botId - Owning bot id.
   * @param {AudienceFilter} data - Target filters.
   * @param {number} [startAfterId] - Resume cursor: only ids greater than this are yielded.
   * @yields {AudienceUser} Next audience member.
   */
  async *iterateAudience(
    botId: number,
    data: AudienceFilter,
    startAfterId = 0,
  ): AsyncGenerator<AudienceUser, void, unknown> {
    let cursor = BigInt(startAfterId);
    for (;;) {
      const rows = await this.prisma.botUser.findMany({
        where: { ...this.audienceWhere(botId, data), telegramId: { gt: cursor } },
        orderBy: { telegramId: 'asc' },
        take: AUDIENCE_BATCH_SIZE,
        select: {
          telegramId: true,
          username: true,
          firstName: true,
          lastName: true,
          languageCode: true,
        },
      });
      if (rows.length === 0) return;
      for (const r of rows) {
        cursor = r.telegramId;
        yield {
          telegram_id: Number(r.telegramId),
          username: r.username,
          first_name: r.firstName,
          last_name: r.lastName,
          language_code: r.languageCode,
        };
      }
      if (rows.length < AUDIENCE_BATCH_SIZE) return;
    }
  }

  /**
   * Sweeps broadcasts left in 'running' or 'queued' state at server startup and marks them 'interrupted'.
   */
  async sweepInterrupted(): Promise<number> {
    const res = await this.prisma.broadcast.updateMany({
      where: {
        status: { in: ['running', 'queued'] },
      },
      data: {
        status: 'interrupted',
      },
    });
    return res.count;
  }

  /**
   * Concludes an A/B experiment atomically: closes the still-queued losing
   * variants and creates the winner rollout row in one transaction, so a
   * crash cannot leave losers open without a rollout (or vice versa).
   * @param {number} botId - Owning bot id.
   * @param {number[]} loserQueuedIds - Still-queued variant rows to cancel.
   * @param {object} rollout - Rollout broadcast payload.
   * @returns {Promise<Broadcast>} Created rollout row.
   */
  async concludeExperiment(
    botId: number,
    loserQueuedIds: number[],
    rollout: {
      targetType: string;
      messageText: string;
      mediaUrl?: string | null;
      buttonsJson?: string | null;
      targetFilterJson?: string | null;
    },
  ): Promise<Broadcast> {
    const rolloutRow = await this.prisma.$transaction(async (tx) => {
      if (loserQueuedIds.length > 0) {
        await tx.broadcast.updateMany({
          where: { id: { in: loserQueuedIds }, status: 'queued' },
          data: { status: 'cancelled' },
        });
      }
      return tx.broadcast.create({
        data: {
          botId,
          targetType: rollout.targetType,
          messageText: rollout.messageText,
          mediaUrl: rollout.mediaUrl ?? null,
          buttonsJson: rollout.buttonsJson ?? null,
          targetFilterJson: rollout.targetFilterJson ?? null,
          totalRecipients: 0,
          successCount: 0,
          failedCount: 0,
          status: 'queued',
          createdAt: new Date().toISOString(),
        },
      });
    });
    this.live.emit('broadcasts', botId);
    return rolloutRow;
  }

  /**
   * Creates a click-tracking redirect link for a broadcast button.
   * @param {number} botId - Owning bot id.
   * @param {number} broadcastId - Broadcast the button belongs to.
   * @param {number} index - Button position (stable link identity).
   * @param {string} url - Destination URL.
   * @returns {Promise<number>} Created link id.
   */
  async createTrackingLink(
    botId: number,
    broadcastId: number,
    index: number,
    url: string,
  ): Promise<number> {
    const existing = await this.prisma.link.findFirst({
      where: { botId, title: `bc:${broadcastId}:${index}` },
    });
    if (existing) return existing.id;
    const link = await this.prisma.link.create({
      data: {
        botId,
        title: `bc:${broadcastId}:${index}`,
        url,
        type: 'broadcast-tracking',
        orderIndex: index,
        isActive: 1,
        createdAt: new Date().toISOString(),
      },
    });
    return link.id;
  }

  /**
   * Credits a tracked-redirect click to the owning broadcast. Called from the
   * public redirect endpoint so `broadcasts.clicks` stays current without
   * per-read reconciliation queries on the dashboard list.
   * @param {number} linkId - Clicked link id.
   * @returns {Promise<void>} Resolves once counters are updated.
   */
  async creditTrackingClick(linkId: number): Promise<void> {
    const link = await this.prisma.link.findUnique({
      where: { id: linkId },
      select: { id: true, title: true },
    });
    if (!link || !link.title.startsWith('bc:')) return;
    const broadcastId = Number(link.title.split(':')[1]);
    if (!Number.isFinite(broadcastId) || broadcastId <= 0) return;
    await this.prisma.broadcast
      .update({ where: { id: broadcastId }, data: { clicks: { increment: 1 } } })
      .catch(() => undefined);
  }
}
