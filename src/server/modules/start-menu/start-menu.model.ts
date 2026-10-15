import { Injectable } from '@nestjs/common';
import type { Link } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Model managing Link (start menu item) entities via Prisma.
 */
@Injectable()
export class StartMenuModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists menu items for a bot ordered by position.
   */
  async list(botId: number): Promise<Link[]> {
    return this.prisma.link.findMany({
      where: { botId },
      orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Lists active menu items for a bot.
   */
  async listActive(botId: number): Promise<Link[]> {
    return this.prisma.link.findMany({
      where: { botId, isActive: 1 },
      orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Finds a menu item by botId and id.
   */
  async findById(botId: number, id: number): Promise<Link | null> {
    return this.prisma.link.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Creates a menu item.
   */
  async create(data: {
    botId: number;
    title: string;
    description?: string | null;
    url: string;
    type?: string;
    orderIndex?: number;
    isActive?: number;
  }): Promise<Link> {
    return this.prisma.link.create({
      data: {
        botId: data.botId,
        title: data.title,
        description: data.description ?? null,
        url: data.url,
        type: data.type ?? 'link',
        orderIndex: data.orderIndex ?? 0,
        isActive: data.isActive ?? 1,
        clickCount: 0,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Updates an existing menu item.
   */
  async update(
    id: number,
    data: {
      title?: string;
      description?: string | null;
      url?: string;
      type?: string;
      orderIndex?: number;
      isActive?: number;
    },
  ): Promise<Link> {
    return this.prisma.link.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletes a menu item.
   */
  async delete(id: number): Promise<void> {
    await this.prisma.link.delete({
      where: { id },
    });
  }

  /**
   * Increments the click count on a link and returns its URL.
   */
  async trackClick(id: number): Promise<string | null> {
    const link = await this.prisma.link.findUnique({
      where: { id },
      select: { url: true },
    });
    if (!link) return null;

    await this.prisma.link.update({
      where: { id },
      data: { clickCount: { increment: 1 } },
    });
    return link.url;
  }
}
