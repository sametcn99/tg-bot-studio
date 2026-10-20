import { Injectable } from '@nestjs/common';
import type { MiniApp, MiniAppOrder } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { MiniAppOrderEntity } from './mini-app.entity';

/**
 * Model managing MiniApp and MiniAppOrder entities via Prisma.
 */
@Injectable()
export class MiniAppModel {
  constructor(private readonly prisma: PrismaService) {}

  private toOrderEntity(record: MiniAppOrder): MiniAppOrderEntity {
    return {
      id: record.id,
      bot_id: record.botId,
      app_id: record.appId,
      telegram_id: Number(record.telegramId),
      total_amount: record.totalAmount,
      currency: record.currency,
      items_json: record.itemsJson,
      status: record.status,
      created_at: record.createdAt,
    };
  }

  /**
   * Lists mini apps for a bot.
   */
  async list(botId: string): Promise<MiniApp[]> {
    return this.prisma.miniApp.findMany({
      where: { botId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Finds a mini app by id.
   */
  async findById(id: string): Promise<MiniApp | null> {
    return this.prisma.miniApp.findUnique({
      where: { id },
    });
  }

  /**
   * Finds a mini app by slug.
   */
  async findBySlug(slug: string): Promise<MiniApp | null> {
    return this.prisma.miniApp.findUnique({
      where: { slug },
    });
  }

  /**
   * Creates a new mini app.
   */
  async create(data: {
    botId: string;
    name: string;
    slug: string;
    templateType: string;
    title: string;
    description?: string | null;
    iconUrl?: string | null;
    configJson?: string | null;
    themeJson?: string | null;
  }): Promise<MiniApp> {
    const now = new Date().toISOString();
    return this.prisma.miniApp.create({
      data: {
        botId: data.botId,
        name: data.name,
        slug: data.slug,
        templateType: data.templateType,
        title: data.title,
        description: data.description ?? null,
        iconUrl: data.iconUrl ?? null,
        configJson: data.configJson ?? null,
        themeJson: data.themeJson ?? null,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  /**
   * Updates an existing mini app.
   */
  async update(
    botId: string,
    id: string,
    data: {
      name?: string;
      title?: string;
      description?: string | null;
      iconUrl?: string | null;
      configJson?: string | null;
      themeJson?: string | null;
      isActive?: number;
    },
  ): Promise<MiniApp> {
    return this.prisma.miniApp.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.iconUrl !== undefined ? { iconUrl: data.iconUrl } : {}),
        ...(data.configJson !== undefined ? { configJson: data.configJson } : {}),
        ...(data.themeJson !== undefined ? { themeJson: data.themeJson } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Deletes a mini app.
   */
  async delete(id: string): Promise<void> {
    await this.prisma.miniApp.delete({
      where: { id },
    });
  }

  /**
   * Creates an order.
   */
  async createOrder(data: {
    botId: string;
    appId: string;
    telegramId: number | bigint;
    totalAmount: number;
    currency: string;
    itemsJson: string;
  }): Promise<MiniAppOrderEntity> {
    const created = await this.prisma.miniAppOrder.create({
      data: {
        botId: data.botId,
        appId: data.appId,
        telegramId: BigInt(data.telegramId),
        totalAmount: data.totalAmount,
        currency: data.currency,
        itemsJson: data.itemsJson,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
    return this.toOrderEntity(created);
  }

  /**
   * Lists orders for an app.
   */
  async listOrders(botId: string, appId: string, limit = 500): Promise<MiniAppOrderEntity[]> {
    const rows = await this.prisma.miniAppOrder.findMany({
      where: { botId, appId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toOrderEntity(r));
  }

  /**
   * Updates one order's lifecycle status (pending → pending_payment → paid).
   */
  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    await this.prisma.miniAppOrder
      .update({ where: { id: orderId }, data: { status } })
      .catch(() => undefined);
  }

  /**
   * Lists recent orders for a user.
   */
  async listUserOrders(
    botId: string,
    telegramId: number | bigint,
    limit = 3,
  ): Promise<MiniAppOrderEntity[]> {
    const rows = await this.prisma.miniAppOrder.findMany({
      where: {
        botId,
        telegramId: BigInt(telegramId),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toOrderEntity(r));
  }
}
