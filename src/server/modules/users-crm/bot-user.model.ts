import { Injectable } from '@nestjs/common';
import type { BlockedUser, BotUser } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { withDbRetry } from '../../database/db-retry';
import type { BotUserEntity } from './bot-user.entity';

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
   * Upserts a subscriber record when receiving messages. Single-statement
   * upsert (the old find-then-write doubled queries on the hottest path and
   * raced under concurrent pollers) with busy retry.
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
    // `undefined` fields keep the stored value; `null` clears it.
    const record = await withDbRetry(
      () =>
        this.prisma.botUser.upsert({
          where: {
            botId_telegramId: { botId, telegramId },
          },
          create: {
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
          update: {
            username: data.username ?? undefined,
            firstName: data.firstName ?? undefined,
            lastName: data.lastName ?? undefined,
            languageCode: data.languageCode ?? undefined,
            lastSeenAt: now,
          },
        }),
      'upsertUser',
    );
    return this.toEntity(record);
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
   * Adjusts a user's point balance (minimum 0). Positive amounts increment
   * atomically (no read-modify-write double-credit race); negative amounts
   * clamp at zero.
   */
  async addPoints(botId: number, telegramId: number | bigint, amount: number): Promise<void> {
    const where = {
      botId_telegramId: {
        botId,
        telegramId: BigInt(telegramId),
      },
    };
    if (amount >= 0) {
      await withDbRetry(
        () =>
          this.prisma.botUser.update({
            where,
            data: { points: { increment: amount } },
          }),
        'addPoints',
      );
      return;
    }
    const user = await this.getUser(botId, telegramId);
    if (!user) return;
    await this.prisma.botUser.update({
      where,
      data: { points: Math.max(0, user.points + amount) },
    });
  }

  /**
   * Sets referrer for a user if not already set, awarding points to the
   * referrer. Both writes run in one transaction so a crash cannot award
   * points without recording (or vice versa).
   */
  async setReferrer(
    botId: number,
    telegramId: number | bigint,
    referrerId: number | bigint,
    pointsPerReferral: number,
  ): Promise<boolean> {
    if (BigInt(telegramId) === BigInt(referrerId)) return false;

    const referrer = await this.getUser(botId, referrerId);
    if (!referrer) return false;

    const claimed = await this.prisma.botUser.updateMany({
      where: {
        botId,
        telegramId: BigInt(telegramId),
        referrerId: null,
      },
      data: { referrerId: BigInt(referrerId) },
    });
    if (claimed.count === 0) return false;

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
   * Server-side paginated CRM listing: search (username/name) and tag filters
   * run in SQL so clients no longer pull the whole subscriber table and
   * filter in memory.
   * @param {number} botId - Owning bot id.
   * @param {object} query - Page/pageSize (max 200) plus optional search/tag.
   * @returns {Promise<{items: BotUserEntity[]; total: number; page: number; pageSize: number}>} One page plus total count.
   */
  async listUsersPage(
    botId: number,
    query: { search?: string; tag?: string; page?: number; pageSize?: number },
  ): Promise<{
    items: BotUserEntity[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Math.floor(Number(query.page ?? 1)) || 1);
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(query.pageSize ?? 50)) || 50));
    const where: Record<string, unknown> = { botId };

    const search = String(query.search ?? '').trim();
    if (search) {
      where.OR = [
        { username: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ];
    }
    const tag = String(query.tag ?? '').trim();
    if (tag) {
      // Tags live in a JSON array column; a LIKE on the serialized form keeps
      // the filter in SQL without normalizing the schema.
      where.tagsJson = { contains: `"${tag.replace(/"/g, '')}"` };
    }

    const [rows, total] = await Promise.all([
      this.prisma.botUser.findMany({
        where: where as never,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.botUser.count({ where: where as never }),
    ]);
    return { items: rows.map((r) => this.toEntity(r)), total, page, pageSize };
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
