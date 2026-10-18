import { Injectable } from '@nestjs/common';
import type { DripCampaign, DripSubscriber } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { DripSubscriberEntity } from './drip.entity';

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
      attempts: r.attempts,
    };
  }

  /**
   * Lists campaigns for a bot.
   */
  async listCampaigns(botId: string): Promise<DripCampaign[]> {
    return this.prisma.dripCampaign.findMany({
      where: { botId },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Finds campaign by id.
   */
  async findCampaignById(id: string): Promise<DripCampaign | null> {
    return this.prisma.dripCampaign.findUnique({
      where: { id },
    });
  }

  /**
   * Finds the first active campaign for a bot.
   */
  async findFirstActive(botId: string): Promise<DripCampaign | null> {
    return this.prisma.dripCampaign.findFirst({
      where: { botId, isActive: 1 },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Counts subscribers for a campaign.
   */
  async countSubscribers(campaignId: string): Promise<number> {
    return this.prisma.dripSubscriber.count({
      where: { campaignId },
    });
  }

  /**
   * Creates a campaign.
   */
  async createCampaign(data: {
    botId: string;
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
    id: string,
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
  async deleteCampaign(id: string): Promise<void> {
    await this.prisma.dripCampaign.delete({
      where: { id },
    });
  }

  /**
   * Subscribes a user to a campaign.
   */
  async subscribe(
    botId: string,
    campaignId: string,
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
        attempts: 0,
      },
    });
  }

  /**
   * Unsubscribes a user from a campaign.
   */
  async unsubscribe(campaignId: string, telegramId: number | bigint): Promise<void> {
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
  async listSubscribers(botId: string, campaignId: string): Promise<DripSubscriberEntity[]> {
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
   * Advances a subscriber to the next step (resets the failure counter).
   */
  async advanceSubscriber(
    campaignId: string,
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
        attempts: 0,
      },
    });
  }

  /**
   * Records a transient delivery failure: bumps the attempt counter and
   * pushes the next attempt a few minutes out so a temporary outage does not
   * hot-loop. The subscriber is NOT unsubscribed here.
   * @param {number} campaignId - Campaign identifier.
   * @param {number | bigint} telegramId - Subscriber id.
   * @returns {Promise<number>} The new attempts count.
   */
  async recordTransientFailure(campaignId: string, telegramId: number | bigint): Promise<number> {
    const updated = await this.prisma.dripSubscriber.update({
      where: {
        campaignId_telegramId: {
          campaignId,
          telegramId: BigInt(telegramId),
        },
      },
      data: {
        attempts: { increment: 1 },
        nextRunAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });
    return updated.attempts;
  }
}
