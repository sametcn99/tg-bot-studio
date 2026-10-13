import { Injectable } from '@nestjs/common';
import type { BlockedUser, BotUser } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Domain shape for bot user data with numeric telegram_id.
 */
export interface BotUserEntity {
  bot_id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  points: number;
  referrer_id: number | null;
  tags_json: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  botId: number;
  telegramId: number;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  referrerId: number | null;
  tagsJson: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

/**
 * Model managing BotUser and BlockedUser entities via Prisma.
 */
@Injectable()
export class BotUserModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Converts Prisma BotUser record into domain BotUserEntity with number ID.
   */
  private toEntity(record: BotUser): BotUserEntity {
    return {
      bot_id: record.botId,
      telegram_id: Number(record.telegramId),
      username: record.username,
      first_name: record.firstName,
      last_name: record.lastName,
      language_code: record.languageCode,
      points: record.points,
      referrer_id: record.referrerId ? Number(record.referrerId) : null,
      tags_json: record.tagsJson,
      first_seen_at: record.firstSeenAt,
      last_seen_at: record.lastSeenAt,
      botId: record.botId,
      telegramId: Number(record.telegramId),
      firstName: record.firstName,
      lastName: record.lastName,
      languageCode: record.languageCode,
      referrerId: record.referrerId ? Number(record.referrerId) : null,
      tagsJson: record.tagsJson,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
    };
  }

  /**
   * Finds a user by botId and telegramId.
   */
  async findByTelegramId(
    botId: number,
    telegramId: number | bigint,
  ): Promise<BotUserEntity | null> {
    return this.getUser(botId, telegramId);
  }

  /**
   * Upserts a subscriber record when receiving messages.
   */
  async upsertUser(
    botId: number,
    data: {
      telegramId: number | bigint;
      username?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      languageCode?: string | null;
    },
  ): Promise<BotUserEntity> {
    const telegramId = BigInt(data.telegramId);
    const now = new Date().toISOString();

    const existing = await this.prisma.botUser.findUnique({
      where: {
        botId_telegramId: { botId, telegramId },
      },
    });

    if (existing) {
      const updated = await this.prisma.botUser.update({
        where: {
          botId_telegramId: { botId, telegramId },
        },
        data: {
          username: data.username ?? existing.username,
          firstName: data.firstName ?? existing.firstName,
          lastName: data.lastName ?? existing.lastName,
          languageCode: data.languageCode ?? existing.languageCode,
          lastSeenAt: now,
        },
      });
      return this.toEntity(updated);
    }

    const created = await this.prisma.botUser.create({
      data: {
        botId,
        telegramId,
        username: data.username ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        languageCode: data.languageCode ?? 'en',
        points: 0,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    return this.toEntity(created);
  }

  /**
   * Finds a user by botId and telegramId.
   */
  async getUser(botId: number, telegramId: number | bigint): Promise<BotUserEntity | null> {
    const record = await this.prisma.botUser.findUnique({
      where: {
        botId_telegramId: {
          botId,
          telegramId: BigInt(telegramId),
        },
      },
    });
    return record ? this.toEntity(record) : null;
  }

  /**
   * Adjusts a user's point balance (minimum 0).
   */
  async addPoints(botId: number, telegramId: number | bigint, amount: number): Promise<void> {
    const user = await this.getUser(botId, telegramId);
    if (!user) return;
    const newPoints = Math.max(0, user.points + amount);
    await this.prisma.botUser.update({
      where: {
        botId_telegramId: {
          botId,
          telegramId: BigInt(telegramId),
        },
      },
      data: { points: newPoints },
    });
  }

  /**
   * Sets referrer for a user if not already set, awarding points to the referrer.
   */
  async setReferrer(
    botId: number,
    telegramId: number | bigint,
    referrerId: number | bigint,
    pointsPerReferral: number,
  ): Promise<boolean> {
    if (BigInt(telegramId) === BigInt(referrerId)) return false;

    const user = await this.getUser(botId, telegramId);
    if (user?.referrer_id) return false;

    const referrer = await this.getUser(botId, referrerId);
    if (!referrer) return false;

    await this.prisma.botUser.update({
      where: {
        botId_telegramId: {
          botId,
          telegramId: BigInt(telegramId),
        },
      },
      data: { referrerId: BigInt(referrerId) },
    });

    await this.addPoints(botId, referrerId, pointsPerReferral);
    return true;
  }

  /**
   * Checks whether a user is blocked.
   */
  async isBlocked(botId: number, telegramId: number | bigint): Promise<boolean> {
    const count = await this.prisma.blockedUser.count({
      where: {
        botId,
        telegramId: BigInt(telegramId),
      },
    });
    return count > 0;
  }

  /**
   * Bans a user for a bot.
   */
  async blockUser(
    botId: number,
    data: {
      telegramId: number | bigint;
      username?: string | null;
      firstName?: string | null;
      reason?: string | null;
    },
  ): Promise<BlockedUser> {
    const telegramId = BigInt(data.telegramId);
    const now = new Date().toISOString();
    return this.prisma.blockedUser.upsert({
      where: {
        botId_telegramId: { botId, telegramId },
      },
      create: {
        botId,
        telegramId,
        username: data.username ?? null,
        firstName: data.firstName ?? null,
        reason: data.reason ?? null,
        blockedAt: now,
      },
      update: {
        reason: data.reason ?? null,
      },
    });
  }

  /**
   * Unbans a user.
   */
  async unblockUser(botId: number, telegramId: number | bigint): Promise<void> {
    await this.prisma.blockedUser
      .delete({
        where: {
          botId_telegramId: {
            botId,
            telegramId: BigInt(telegramId),
          },
        },
      })
      .catch(() => undefined);
  }

  /**
   * Lists blocked users for a bot.
   */
  async listBlocked(botId: number): Promise<BlockedUser[]> {
    return this.prisma.blockedUser.findMany({
      where: { botId },
      orderBy: { blockedAt: 'desc' },
    });
  }

  /**
   * Lists subscribers with a limit.
   */
  async listUsers(botId: number, limit = 2000): Promise<BotUserEntity[]> {
    const rows = await this.prisma.botUser.findMany({
      where: { botId },
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * Updates tags and notes JSON on a user.
   */
  async updateTags(
    botId: number,
    telegramId: number | bigint,
    tagsJson: string,
  ): Promise<BotUserEntity> {
    const updated = await this.prisma.botUser.update({
      where: {
        botId_telegramId: {
          botId,
          telegramId: BigInt(telegramId),
        },
      },
      data: { tagsJson },
    });
    return this.toEntity(updated);
  }

  /**
   * Top referrers by points.
   */
  async getReferralTop(
    botId: number,
    limit: number,
  ): Promise<
    Array<{
      telegram_id: number;
      first_name: string | null;
      username: string | null;
      points: number;
    }>
  > {
    const rows = await this.prisma.botUser.findMany({
      where: { botId, points: { gt: 0 } },
      orderBy: { points: 'desc' },
      take: limit,
      select: {
        telegramId: true,
        firstName: true,
        username: true,
        points: true,
      },
    });
    return rows.map((r) => ({
      telegram_id: Number(r.telegramId),
      first_name: r.firstName,
      username: r.username,
      points: r.points,
    }));
  }
}
