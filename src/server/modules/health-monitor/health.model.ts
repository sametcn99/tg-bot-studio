import { Injectable } from '@nestjs/common';
import type { HealthEvent } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Model managing health alert events via Prisma.
 */
@Injectable()
export class HealthModel {
  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a health event.
   * @param {object} data - Event fields.
   * @returns {Promise<HealthEvent>} Created row.
   */
  async create(data: {
    botId: number;
    level: string;
    reason?: string | null;
    message: string;
    notified: number;
  }): Promise<HealthEvent> {
    return this.prisma.healthEvent.create({
      data: { ...data, createdAt: new Date().toISOString() },
    });
  }

  /**
   * Lists the most recent health events, optionally scoped to one bot.
   * @param {number} [botId] - Optional bot filter.
   * @param {number} [limit] - Maximum rows (default 50).
   * @returns {Promise<HealthEvent[]>} Newest events first.
   */
  async listRecent(botId?: number, limit = 50): Promise<HealthEvent[]> {
    return this.prisma.healthEvent.findMany({
      where: botId ? { botId } : undefined,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }
}
