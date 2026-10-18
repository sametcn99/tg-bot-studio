import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { BotModel } from './bot.model';

/** One day of aggregated activity. */
export interface ActivityDay {
  day: string;
  messages: number;
  replies: number;
  media: number;
}

/** Bot analytics overview payload for the dashboard charts. */
export interface BotAnalytics {
  subscribers: number;
  activeModules: number;
  miniApps: number;
  totalUsers: number;
  activeLast7d: number;
  daily: ActivityDay[];
}

/**
 * Bot-level analytics: audience totals plus per-day message/reply/media
 * trends sourced from the ChatActivity ledger the engine already records.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botModel: BotModel,
  ) {}

  /**
   * Builds the analytics overview for a bot.
   * @param {number} botId - Bot identifier.
   * @param {number} [days] - Trailing window (7 or 30).
   * @returns {Promise<BotAnalytics>} Aggregated overview.
   */
  async overview(botId: string, days = 7): Promise<BotAnalytics> {
    const window = days >= 30 ? 30 : 7;
    const since = new Date(Date.now() - (window - 1) * 86_400_000).toISOString().slice(0, 10);

    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const [subscribers, activeModules, miniApps, totalUsers, activeLast7dRows, grouped] =
      await Promise.all([
        this.botModel.countSubscribers(botId),
        this.botModel.countActiveModules(botId),
        this.botModel.countMiniApps(botId),
        this.prisma.botUser.count({ where: { botId } }),
        // COUNT(DISTINCT) database-side: the old groupBy returned one row per
        // active user just to count them.
        this.prisma.$queryRaw<Array<{ c: bigint }>>(
          Prisma.sql`SELECT COUNT(DISTINCT telegram_id) AS c FROM chat_activity WHERE bot_id = ${botId} AND day >= ${since7}`,
        ),
        this.prisma.chatActivity.groupBy({
          by: ['day'],
          where: { botId, day: { gte: since } },
          _sum: { messageCount: true, replyCount: true, mediaCount: true },
          orderBy: { day: 'asc' },
        }),
      ]);

    const byDay = new Map(grouped.map((row) => [row.day, row]));
    const daily: ActivityDay[] = [];
    for (let offset = window - 1; offset >= 0; offset--) {
      const day = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      const row = byDay.get(day);
      daily.push({
        day,
        messages: row?._sum.messageCount ?? 0,
        replies: row?._sum.replyCount ?? 0,
        media: row?._sum.mediaCount ?? 0,
      });
    }

    return {
      subscribers,
      activeModules,
      miniApps,
      totalUsers,
      activeLast7d: Number(activeLast7dRows[0]?.c ?? 0),
      daily,
    };
  }
}
