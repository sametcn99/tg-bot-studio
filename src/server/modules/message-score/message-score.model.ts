import { Injectable } from '@nestjs/common';
import type { ScoreSchedule } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { LeaderboardEntryEntity } from './message-score.entity';

/**
 * Model managing ChatActivity and ScoreSchedule entities via Prisma.
 */
@Injectable()
export class MessageScoreModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one activity event for a member in a chat.
   */
  async recordActivity(
    botId: number,
    chatId: string,
    telegramId: number | bigint,
    flags: { reply: boolean; media: boolean },
  ): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const tid = BigInt(telegramId);

    const existing = await this.prisma.chatActivity.findUnique({
      where: {
        botId_chatId_telegramId_day: {
          botId,
          chatId,
          telegramId: tid,
          day,
        },
      },
    });

    if (existing) {
      await this.prisma.chatActivity.update({
        where: {
          botId_chatId_telegramId_day: {
            botId,
            chatId,
            telegramId: tid,
            day,
          },
        },
        data: {
          messageCount: existing.messageCount + 1,
          replyCount: existing.replyCount + (flags.reply ? 1 : 0),
          mediaCount: existing.mediaCount + (flags.media ? 1 : 0),
        },
      });
    } else {
      await this.prisma.chatActivity.create({
        data: {
          botId,
          chatId,
          telegramId: tid,
          day,
          messageCount: 1,
          replyCount: flags.reply ? 1 : 0,
          mediaCount: flags.media ? 1 : 0,
        },
      });
    }
  }

  /**
   * Computes the weighted activity leaderboard using Prisma groupBy.
   */
  async getLeaderboard(
    botId: number,
    chatId: string | undefined,
    sinceDay: string,
    limit: number,
    weights: { message: number; reply: number; media: number },
  ): Promise<LeaderboardEntryEntity[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);

    const groups = await this.prisma.chatActivity.groupBy({
      by: ['telegramId'],
      where: {
        botId,
        day: { gte: sinceDay },
        ...(chatId ? { chatId } : {}),
      },
      _sum: {
        messageCount: true,
        replyCount: true,
        mediaCount: true,
      },
    });

    if (groups.length === 0) return [];

    const telegramIds = groups.map((g) => g.telegramId);
    const users = await this.prisma.botUser.findMany({
      where: {
        botId,
        telegramId: { in: telegramIds },
      },
      select: {
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.telegramId.toString(), u]));

    const results: LeaderboardEntryEntity[] = groups.map((g) => {
      const messages = g._sum.messageCount ?? 0;
      const replies = g._sum.replyCount ?? 0;
      const media = g._sum.mediaCount ?? 0;
      const score = messages * weights.message + replies * weights.reply + media * weights.media;
      const user = userMap.get(g.telegramId.toString());

      return {
        telegram_id: Number(g.telegramId),
        username: user?.username ?? null,
        first_name: user?.firstName ?? null,
        last_name: user?.lastName ?? null,
        messages,
        replies,
        media,
        score,
      };
    });

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.messages - a.messages;
    });

    return results.slice(0, safeLimit);
  }

  /**
   * Deletes raw activity buckets older than cutoff day.
   */
  async pruneOldActivity(cutoffDay: string): Promise<void> {
    await this.prisma.chatActivity.deleteMany({
      where: {
        day: { lt: cutoffDay },
      },
    });
  }

  /**
   * Lists score schedules for a bot.
   */
  async listSchedules(botId: number): Promise<ScoreSchedule[]> {
    return this.prisma.scoreSchedule.findMany({
      where: { botId },
      orderBy: [{ status: 'desc' }, { runAt: 'asc' }],
    });
  }

  /**
   * Finds a score schedule by id.
   */
  async findScheduleById(botId: number, id: number): Promise<ScoreSchedule | null> {
    return this.prisma.scoreSchedule.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Creates a score schedule.
   */
  async createSchedule(data: {
    botId: number;
    name: string;
    chatIdsJson: string;
    period: string;
    frequency: string;
    timeOfDay?: string | null;
    dayOfWeek?: number | null;
    runAt: string;
    topLimit: number;
    headerText?: string | null;
    rowTemplate?: string | null;
    footerText?: string | null;
    parseMode?: string | null;
    medals?: number;
    disableNotification?: number;
  }): Promise<ScoreSchedule> {
    return this.prisma.scoreSchedule.create({
      data: {
        botId: data.botId,
        name: data.name,
        chatIdsJson: data.chatIdsJson,
        period: data.period,
        frequency: data.frequency,
        timeOfDay: data.timeOfDay ?? '18:00',
        dayOfWeek: data.dayOfWeek ?? 1,
        runAt: data.runAt,
        topLimit: data.topLimit,
        headerText: data.headerText ?? null,
        rowTemplate: data.rowTemplate ?? null,
        footerText: data.footerText ?? null,
        parseMode: data.parseMode ?? 'HTML',
        medals: data.medals ?? 1,
        disableNotification: data.disableNotification ?? 0,
        status: 'active',
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Updates an existing score schedule.
   */
  async updateSchedule(
    id: number,
    data: {
      name?: string;
      chatIdsJson?: string;
      period?: string;
      frequency?: string;
      timeOfDay?: string | null;
      dayOfWeek?: number | null;
      runAt?: string;
      topLimit?: number;
      headerText?: string | null;
      rowTemplate?: string | null;
      footerText?: string | null;
      parseMode?: string | null;
      medals?: number;
      disableNotification?: number;
      status?: string;
    },
  ): Promise<ScoreSchedule> {
    return this.prisma.scoreSchedule.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletes a score schedule.
   */
  async deleteSchedule(id: number): Promise<void> {
    await this.prisma.scoreSchedule.delete({
      where: { id },
    });
  }

  /**
   * Finds due active schedules.
   */
  async findDueSchedules(nowIso: string): Promise<ScoreSchedule[]> {
    return this.prisma.scoreSchedule.findMany({
      where: {
        status: 'active',
        runAt: { lte: nowIso },
      },
    });
  }

  /**
   * Updates result after dispatching a schedule.
   */
  async updateScheduleDispatch(
    id: number,
    data: {
      runAt: string;
      status: string;
      lastResult: string;
    },
  ): Promise<void> {
    await this.prisma.scoreSchedule.update({
      where: { id },
      data: {
        runAt: data.runAt,
        status: data.status,
        lastRunAt: new Date().toISOString(),
        lastResult: data.lastResult,
      },
    });
  }
}
