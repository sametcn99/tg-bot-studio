import { Injectable } from '@nestjs/common';
import type { Broadcast } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import type { BotUserEntity } from '../users-crm/bot-user.entity';

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
  }): Promise<Broadcast> {
    const created = await this.prisma.broadcast.create({
      data: {
        botId: data.botId,
        targetType: data.targetType,
        messageText: data.messageText,
        mediaUrl: data.mediaUrl ?? null,
        buttonsJson: data.buttonsJson ?? null,
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
   * Updates status, counters, or experiment metadata of a broadcast.
   */
  async updateStatus(
    id: number,
    data: {
      status?: string;
      totalRecipients?: number;
      successCount?: number;
      failedCount?: number;
      experimentId?: string;
      variantLabel?: string;
      phase?: string;
    },
  ): Promise<Broadcast> {
    const updated = await this.prisma.broadcast.update({
      where: { id },
      data,
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
   * Resolves target audience for a broadcast.
   */
  async resolveAudience(
    botId: number,
    data: {
      targetType?: string;
      language?: string;
      recentDays?: number;
    },
  ): Promise<BotUserEntity[]> {
    const targetType = data.targetType ?? 'all';
    let whereClause: Record<string, unknown> = { botId };

    if (targetType === 'language') {
      whereClause = {
        botId,
        languageCode: data.language ?? 'en',
      };
    } else if (targetType === 'recent') {
      const days = Number(data.recentDays ?? 7);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      whereClause = {
        botId,
        lastSeenAt: { gte: since },
      };
    }

    const rows = await this.prisma.botUser.findMany({
      where: whereClause,
      orderBy: { lastSeenAt: 'desc' },
    });

    return rows.map((r) => ({
      bot_id: r.botId,
      telegram_id: Number(r.telegramId),
      username: r.username,
      first_name: r.firstName,
      last_name: r.lastName,
      language_code: r.languageCode,
      points: r.points,
      referrer_id: r.referrerId ? Number(r.referrerId) : null,
      tags_json: r.tagsJson,
      first_seen_at: r.firstSeenAt,
      last_seen_at: r.lastSeenAt,
      botId: r.botId,
      telegramId: Number(r.telegramId),
      firstName: r.firstName,
      lastName: r.lastName,
      languageCode: r.languageCode,
      referrerId: r.referrerId ? Number(r.referrerId) : null,
      tagsJson: r.tagsJson,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
    }));
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
   * Sums redirect-link clicks tagged `bc:<broadcastId>:` back into
   * `broadcasts.clicks` for the given rows (CTR tracking).
   * @param {Broadcast[]} rows - Broadcast rows to reconcile (recent subset).
   * @returns {Promise<Broadcast[]>} The same rows with up-to-date clicks.
   */
  async syncClickCounts(rows: Broadcast[]): Promise<Broadcast[]> {
    for (const row of rows.slice(0, 50)) {
      const links = await this.prisma.link.findMany({
        where: { botId: row.botId, title: { startsWith: `bc:${row.id}:` } },
        select: { clickCount: true },
      });
      const total = links.reduce((sum, link) => sum + link.clickCount, 0);
      if (total !== row.clicks) {
        await this.prisma.broadcast.update({ where: { id: row.id }, data: { clicks: total } });
        row.clicks = total;
      }
    }
    return rows;
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
}
