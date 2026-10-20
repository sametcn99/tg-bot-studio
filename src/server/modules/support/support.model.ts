import { Injectable } from '@nestjs/common';
import type { SupportMessage } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import type { SupportMessageEntity, SupportThreadEntity } from './support.entity';

/**
 * Model managing SupportMessage entities via Prisma.
 */
@Injectable()
export class SupportModel {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveEventsService,
  ) {}

  private toEntity(r: SupportMessage): SupportMessageEntity {
    return {
      id: r.id,
      bot_id: r.botId,
      telegram_id: Number(r.telegramId),
      user_message_id: r.userMessageId,
      admin_chat_id: r.adminChatId ? Number(r.adminChatId) : null,
      forum_topic_id: r.forumTopicId,
      direction: r.direction,
      sender_name: r.senderName,
      message_text: r.messageText,
      media_type: r.mediaType,
      created_at: r.createdAt,
    };
  }

  /**
   * Lists support messages for a bot.
   */
  async listMessages(botId: string, limit = 500): Promise<SupportMessageEntity[]> {
    const rows = await this.prisma.supportMessage.findMany({
      where: { botId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * Lists conversation threads grouped by user. Aggregation happens in SQL
   * (groupBy + latest-message fetch); the old version hydrated every support
   * message of the bot into memory on each inbox load.
   */
  async listThreads(botId: string): Promise<SupportThreadEntity[]> {
    const groups = await this.prisma.supportMessage.groupBy({
      by: ['telegramId'],
      where: { botId },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const latestCreatedAts = groups
      .map((g) => g._max.createdAt)
      .filter((c): c is string => Boolean(c));
    const latestRows =
      latestCreatedAts.length > 0
        ? await this.prisma.supportMessage.findMany({
            where: { botId, createdAt: { in: latestCreatedAts } },
            select: { telegramId: true, senderName: true, messageText: true, createdAt: true },
          })
        : [];
    const byTelegramId = new Map(latestRows.map((row) => [row.telegramId.toString(), row]));

    const threads: SupportThreadEntity[] = [];
    for (const group of groups) {
      const newest = byTelegramId.get(group.telegramId.toString());
      threads.push({
        telegram_id: Number(group.telegramId),
        sender_name: newest?.senderName ?? null,
        message_count: group._count._all,
        last_activity: group._max.createdAt ?? newest?.createdAt ?? null,
        last_message: newest?.messageText ?? null,
      });
    }

    return threads.sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''));
  }

  /**
   * Creates a new support message.
   */
  async createMessage(data: {
    botId: string;
    telegramId: number | bigint;
    userMessageId?: number | null;
    adminChatId?: number | bigint | null;
    forumTopicId?: number | null;
    direction: string;
    senderName?: string | null;
    messageText?: string | null;
    mediaType?: string | null;
  }): Promise<SupportMessageEntity> {
    const created = await this.prisma.supportMessage.create({
      data: {
        botId: data.botId,
        telegramId: BigInt(data.telegramId),
        userMessageId: data.userMessageId ?? null,
        adminChatId: data.adminChatId ? BigInt(data.adminChatId) : null,
        forumTopicId: data.forumTopicId ?? null,
        direction: data.direction,
        senderName: data.senderName ?? null,
        messageText: data.messageText ?? null,
        mediaType: data.mediaType ?? null,
        createdAt: new Date().toISOString(),
      },
    });
    this.live.emit('support', data.botId);
    return this.toEntity(created);
  }

  /**
   * Finds latest forum topic mapping for a user.
   */
  async findLatestTopicForUser(
    botId: string,
    telegramId: number | bigint,
  ): Promise<{ admin_chat_id: number; forum_topic_id: number } | null> {
    const row = await this.prisma.supportMessage.findFirst({
      where: {
        botId,
        telegramId: BigInt(telegramId),
        forumTopicId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        adminChatId: true,
        forumTopicId: true,
      },
    });

    if (!row || !row.adminChatId || !row.forumTopicId) return null;
    return {
      admin_chat_id: Number(row.adminChatId),
      forum_topic_id: row.forumTopicId,
    };
  }

  /**
   * Gets conversation history for copilot draft generation.
   */
  async getThreadHistory(
    botId: string,
    telegramId: number | bigint,
    limit = 10,
  ): Promise<Array<{ direction: string; message_text: string }>> {
    const rows = await this.prisma.supportMessage.findMany({
      where: {
        botId,
        telegramId: BigInt(telegramId),
        messageText: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        direction: true,
        messageText: true,
      },
    });
    return rows.reverse().map((r) => ({
      direction: r.direction,
      message_text: r.messageText ?? '',
    }));
  }
}
