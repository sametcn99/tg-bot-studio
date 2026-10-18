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
    botId: string;
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
  async listRecent(botId?: string, limit = 50): Promise<HealthEvent[]> {
    return this.prisma.healthEvent.findMany({
      where: botId ? { botId } : undefined,
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  /**
   * Lists undelivered alerts from the last day, oldest first, for the retry
   * pass in the monitor sweep.
   * @param {number} [limit] - Maximum rows per retry pass.
   * @returns {Promise<HealthEvent[]>} Unnotified events, oldest first.
   */
  async listUndelivered(limit = 25): Promise<HealthEvent[]> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return this.prisma.healthEvent.findMany({
      where: { notified: 0, createdAt: { gte: cutoff }, level: { not: 'stopped' } },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  /**
   * Marks an event as delivered after a successful retry.
   * @param {number} id - Event id.
   * @returns {Promise<void>} Resolves once updated.
   */
  async markNotified(id: string): Promise<void> {
    await this.prisma.healthEvent.update({ where: { id }, data: { notified: 1 } });
  }
}
