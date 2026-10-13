import { Injectable } from '@nestjs/common';
import type { Broadcast } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { BotUserEntity } from './bot-user.model';

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
  botId: number;
  targetType: string;
  messageText: string;
  mediaUrl: string | null;
  buttonsJson: string | null;
  totalRecipients: number;
  successCount: number;
  failedCount: number;
  createdAt: string | null;
}

export function toBroadcastRow(b: Broadcast): BroadcastRow {
  return {
    id: b.id,
    bot_id: b.botId,
    target_type: b.targetType,
    message_text: b.messageText,
    media_url: b.mediaUrl,
    buttons_json: b.buttonsJson,
    total_recipients: b.totalRecipients,
    success_count: b.successCount,
    failed_count: b.failedCount,
    status: b.status,
    created_at: b.createdAt,
    botId: b.botId,
    targetType: b.targetType,
    messageText: b.messageText,
    mediaUrl: b.mediaUrl,
    buttonsJson: b.buttonsJson,
    totalRecipients: b.totalRecipients,
    successCount: b.successCount,
    failedCount: b.failedCount,
    createdAt: b.createdAt,
  };
}

/**
 * Model managing Broadcast entities and audience queries via Prisma.
 */
@Injectable()
export class BroadcastModel {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.broadcast.create({
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
  }

  /**
   * Updates status and counts of a broadcast.
   */
  async updateStatus(
    id: number,
    data: {
      status: string;
      totalRecipients?: number;
      successCount?: number;
      failedCount?: number;
    },
  ): Promise<Broadcast> {
    return this.prisma.broadcast.update({
      where: { id },
      data,
    });
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
}
