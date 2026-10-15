import { Injectable } from '@nestjs/common';
import type { Giveaway } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Model managing Giveaway entities via Prisma.
 */
@Injectable()
export class GiveawayModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists giveaways for a bot newest first.
   */
  async list(botId: number): Promise<Giveaway[]> {
    return this.prisma.giveaway.findMany({
      where: { botId },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * Finds a giveaway by botId and id.
   */
  async findById(botId: number, id: number): Promise<Giveaway | null> {
    return this.prisma.giveaway.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Creates a giveaway.
   */
  async create(data: {
    botId: number;
    title: string;
    requiredChannelsJson?: string | null;
    winnersCount?: number;
    prizeDetails?: string | null;
    endsAt?: string | null;
  }): Promise<Giveaway> {
    return this.prisma.giveaway.create({
      data: {
        botId: data.botId,
        title: data.title,
        requiredChannelsJson: data.requiredChannelsJson ?? null,
        winnersCount: data.winnersCount ?? 1,
        prizeDetails: data.prizeDetails ?? null,
        endsAt: data.endsAt ?? null,
        status: 'active',
      },
    });
  }

  /**
   * Updates an existing giveaway.
   */
  async update(
    id: number,
    data: {
      title?: string;
      requiredChannelsJson?: string | null;
      winnersCount?: number;
      prizeDetails?: string | null;
      endsAt?: string | null;
    },
  ): Promise<Giveaway> {
    return this.prisma.giveaway.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletes a giveaway.
   */
  async delete(id: number): Promise<void> {
    await this.prisma.giveaway.delete({
      where: { id },
    });
  }

  /**
   * Finds active giveaways whose endsAt has passed.
   */
  async findDue(nowIso: string): Promise<Giveaway[]> {
    return this.prisma.giveaway.findMany({
      where: {
        status: 'active',
        endsAt: {
          not: null,
          lte: nowIso,
        },
      },
    });
  }

  /**
   * Marks a giveaway as finished.
   */
  async finish(id: number): Promise<Giveaway> {
    return this.prisma.giveaway.update({
      where: { id },
      data: { status: 'finished' },
    });
  }
}
