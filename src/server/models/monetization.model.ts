import { Injectable } from '@nestjs/common';
import type { VipSubscription } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Domain shape for VIP subscription with number IDs.
 */
export interface VipSubscriptionEntity {
  id: number;
  bot_id: number;
  telegram_id: number;
  channel_id: number;
  expires_at: string;
  is_active: number;
}

/**
 * Model managing VipSubscription entities via Prisma.
 */
@Injectable()
export class MonetizationModel {
  constructor(private readonly prisma: PrismaService) {}

  private toEntity(r: VipSubscription): VipSubscriptionEntity {
    return {
      id: r.id,
      bot_id: r.botId,
      telegram_id: Number(r.telegramId),
      channel_id: Number(r.channelId),
      expires_at: r.expiresAt,
      is_active: r.isActive,
    };
  }

  /**
   * Creates a VIP subscription record.
   */
  async createSubscription(data: {
    botId: number;
    telegramId: number | bigint;
    channelId: number | bigint;
    expiresAt: string;
  }): Promise<VipSubscriptionEntity> {
    const created = await this.prisma.vipSubscription.create({
      data: {
        botId: data.botId,
        telegramId: BigInt(data.telegramId),
        channelId: BigInt(data.channelId),
        expiresAt: data.expiresAt,
        isActive: 1,
      },
    });
    return this.toEntity(created);
  }

  /**
   * Lists VIP subscriptions for a bot newest first.
   */
  async listSubscriptions(botId: number): Promise<VipSubscriptionEntity[]> {
    const rows = await this.prisma.vipSubscription.findMany({
      where: { botId },
      orderBy: { id: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * Finds a subscription by botId and id.
   */
  async findById(botId: number, id: number): Promise<VipSubscriptionEntity | null> {
    const row = await this.prisma.vipSubscription.findFirst({
      where: { botId, id },
    });
    return row ? this.toEntity(row) : null;
  }

  /**
   * Deactivates a subscription.
   */
  async deactivate(id: number): Promise<void> {
    await this.prisma.vipSubscription.update({
      where: { id },
      data: { isActive: 0 },
    });
  }

  /**
   * Finds active subscriptions whose expiresAt has passed.
   */
  async findExpired(nowIso: string): Promise<VipSubscriptionEntity[]> {
    const rows = await this.prisma.vipSubscription.findMany({
      where: {
        isActive: 1,
        expiresAt: { lte: nowIso },
      },
    });
    return rows.map((r) => this.toEntity(r));
  }
}
