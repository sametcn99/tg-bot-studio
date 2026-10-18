import { Injectable } from '@nestjs/common';
import type { ScheduledPost } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Model managing ScheduledPost entities via Prisma.
 */
@Injectable()
export class SchedulerModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists scheduled posts for a bot.
   */
  async list(botId: string): Promise<ScheduledPost[]> {
    return this.prisma.scheduledPost.findMany({
      where: { botId },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  /**
   * Finds a post by botId and id.
   */
  async findById(botId: string, id: string): Promise<ScheduledPost | null> {
    return this.prisma.scheduledPost.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Creates a scheduled post.
   */
  async create(data: {
    botId: string;
    targetChatId: string;
    messageText: string;
    mediaUrl?: string | null;
    buttonsJson?: string | null;
    scheduledAt: string;
  }): Promise<ScheduledPost> {
    return this.prisma.scheduledPost.create({
      data: {
        botId: data.botId,
        targetChatId: data.targetChatId,
        messageText: data.messageText,
        mediaUrl: data.mediaUrl ?? null,
        buttonsJson: data.buttonsJson ?? null,
        scheduledAt: data.scheduledAt,
        status: 'pending',
      },
    });
  }

  /**
   * Updates an existing scheduled post.
   */
  async update(
    id: string,
    data: {
      targetChatId?: string;
      messageText?: string;
      mediaUrl?: string | null;
      buttonsJson?: string | null;
      scheduledAt?: string;
    },
  ): Promise<ScheduledPost> {
    return this.prisma.scheduledPost.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletes a scheduled post.
   */
  async delete(id: string): Promise<void> {
    await this.prisma.scheduledPost.delete({
      where: { id },
    });
  }

  /**
   * Finds pending posts whose scheduledAt has arrived.
   */
  async findDue(nowIso: string): Promise<ScheduledPost[]> {
    return this.prisma.scheduledPost.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: nowIso },
      },
    });
  }

  /**
   * Updates the status of a post.
   */
  async updateStatus(id: string, status: string): Promise<ScheduledPost> {
    return this.prisma.scheduledPost.update({
      where: { id },
      data: { status },
    });
  }
}
