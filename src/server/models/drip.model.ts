import { Injectable } from '@nestjs/common';
import type { DripCampaign, DripSubscriber } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Domain shape for drip subscriber with number telegram_id.
 */
export interface DripSubscriberEntity {
  bot_id: number;
  campaign_id: number;
  telegram_id: number;
  current_step: number;
  next_run_at: string | null;
}

/**
 * Model managing DripCampaign and DripSubscriber entities via Prisma.
 */
@Injectable()
export class DripModel {
  constructor(private readonly prisma: PrismaService) {}

  private toSubscriberEntity(r: DripSubscriber): DripSubscriberEntity {
    return {
      bot_id: r.botId,
      campaign_id: r.campaignId,
      telegram_id: Number(r.telegramId),
      current_step: r.currentStep,
      next_run_at: r.nextRunAt,
    };
  }

  /**
   * Lists campaigns for a bot.
   */
  async listCampaigns(botId: number): Promise<DripCampaign[]> {
    return this.prisma.dripCampaign.findMany({
      where: { botId },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Finds campaign by id.
   */
  async findCampaignById(id: number): Promise<DripCampaign | null> {
    return this.prisma.dripCampaign.findUnique({
      where: { id },
    });
  }

  /**
   * Finds the first active campaign for a bot.
   */
  async findFirstActive(botId: number): Promise<DripCampaign | null> {
    return this.prisma.dripCampaign.findFirst({
      where: { botId, isActive: 1 },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Counts subscribers for a campaign.
   */
  async countSubscribers(campaignId: number): Promise<number> {
    return this.prisma.dripSubscriber.count({
      where: { campaignId },
    });
  }

  /**
   * Creates a campaign.
   */
  async createCampaign(data: {
    botId: number;
    name: string;
    stepsJson: string;
    isActive?: number;
  }): Promise<DripCampaign> {
    return this.prisma.dripCampaign.create({
      data: {
        botId: data.botId,
        name: data.name,
        stepsJson: data.stepsJson,
        isActive: data.isActive ?? 1,
      },
    });
  }

  /**
   * Updates a campaign.
   */
  async updateCampaign(
    id: number,
    data: {
      name?: string;
      stepsJson?: string;
      isActive?: number;
    },
  ): Promise<DripCampaign> {
    return this.prisma.dripCampaign.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletes a campaign.
   */
  async deleteCampaign(id: number): Promise<void> {
    await this.prisma.dripCampaign.delete({
      where: { id },
    });
  }

  /**
   * Subscribes a user to a campaign.
   */
  async subscribe(
    botId: number,
    campaignId: number,
    telegramId: number | bigint,
    nextRunAt: string,
  ): Promise<void> {
    const tid = BigInt(telegramId);
    await this.prisma.dripSubscriber.upsert({
      where: {
        campaignId_telegramId: { campaignId, telegramId: tid },
      },
      create: {
        botId,
        campaignId,
        telegramId: tid,
        currentStep: 0,
        nextRunAt,
      },
      update: {
        currentStep: 0,
        nextRunAt,
      },
    });
  }

  /**
   * Unsubscribes a user from a campaign.
   */
  async unsubscribe(campaignId: number, telegramId: number | bigint): Promise<void> {
    await this.prisma.dripSubscriber
      .delete({
        where: {
          campaignId_telegramId: {
            campaignId,
            telegramId: BigInt(telegramId),
          },
        },
      })
      .catch(() => undefined);
  }

  /**
   * Lists subscribers for a campaign.
   */
  async listSubscribers(botId: number, campaignId: number): Promise<DripSubscriberEntity[]> {
    const rows = await this.prisma.dripSubscriber.findMany({
      where: { botId, campaignId },
    });
    return rows.map((r) => this.toSubscriberEntity(r));
  }

  /**
   * Finds subscribers due for next step.
   */
  async findDueSubscribers(nowIso: string): Promise<DripSubscriberEntity[]> {
    const rows = await this.prisma.dripSubscriber.findMany({
      where: {
        nextRunAt: {
          not: null,
          lte: nowIso,
        },
      },
    });
    return rows.map((r) => this.toSubscriberEntity(r));
  }

  /**
   * Advances a subscriber to the next step.
   */
  async advanceSubscriber(
    campaignId: number,
    telegramId: number | bigint,
    nextIndex: number,
    nextRunAt: string,
  ): Promise<void> {
    await this.prisma.dripSubscriber.update({
      where: {
        campaignId_telegramId: {
          campaignId,
          telegramId: BigInt(telegramId),
        },
      },
      data: {
        currentStep: nextIndex,
        nextRunAt,
      },
    });
  }
}
