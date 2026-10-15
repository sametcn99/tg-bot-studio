import { Injectable, NotFoundException } from '@nestjs/common';
import type { Link } from '@prisma/client';
import { StartMenuModel } from './start-menu.model';

/**
 * Menu item row in the `links` table backing the Start Menu module.
 */
export interface MenuItemRow {
  id: number;
  bot_id: number;
  title: string;
  description: string | null;
  url: string;
  type: string;
  order_index: number;
  is_active: number;
  click_count: number;
  created_at: string | null;
}

/**
 * CRUD service for Start Menu items (chat folders, channels, groups, web links).
 * Backed by StartMenuModel and Prisma.
 */
@Injectable()
export class StartMenuService {
  /**
   * @param {StartMenuModel} menuModel - Domain model for start menu items.
   */
  constructor(private readonly menuModel: StartMenuModel) {}

  private toRow(r: Link): MenuItemRow {
    return {
      id: r.id,
      bot_id: r.botId,
      title: r.title,
      description: r.description,
      url: r.url,
      type: r.type,
      order_index: r.orderIndex,
      is_active: r.isActive,
      click_count: r.clickCount,
      created_at: r.createdAt,
    };
  }

  /**
   * Lists menu items for a bot ordered by position.
   */
  async list(botId: number): Promise<MenuItemRow[]> {
    const rows = await this.menuModel.list(botId);
    return rows.map((r) => this.toRow(r));
  }

  /**
   * Creates a menu item.
   */
  async create(botId: number, data: Record<string, unknown>): Promise<MenuItemRow> {
    const created = await this.menuModel.create({
      botId,
      title: String(data.title ?? ''),
      description: (data.description as string) ?? null,
      url: String(data.url ?? ''),
      type: String(data.type ?? 'link'),
      orderIndex: Number(data.orderIndex ?? 0),
      isActive: data.isActive === false ? 0 : 1,
    });
    return this.toRow(created);
  }

  /**
   * Updates a menu item.
   */
  async update(botId: number, id: number, data: Record<string, unknown>): Promise<MenuItemRow> {
    await this.findOne(botId, id);
    const updated = await this.menuModel.update(id, {
      title: data.title !== undefined ? String(data.title) : undefined,
      description: data.description !== undefined ? (data.description as string) : undefined,
      url: data.url !== undefined ? String(data.url) : undefined,
      type: data.type !== undefined ? String(data.type) : undefined,
      orderIndex: data.orderIndex !== undefined ? Number(data.orderIndex) : undefined,
      isActive: data.isActive === undefined ? undefined : data.isActive ? 1 : 0,
    });
    return this.toRow(updated);
  }

  /**
   * Deletes a menu item.
   */
  async remove(botId: number, id: number): Promise<void> {
    await this.findOne(botId, id);
    await this.menuModel.delete(id);
  }

  /**
   * Registers a click and returns the redirect target.
   */
  async trackClick(id: number): Promise<string | null> {
    return this.menuModel.trackClick(id);
  }

  /**
   * Fetches a single menu item scoped to a bot.
   */
  async findOne(botId: number, id: number): Promise<MenuItemRow> {
    const row = await this.menuModel.findById(botId, id);
    if (!row) throw new NotFoundException(`Menu item ${id} not found`);
    return this.toRow(row);
  }
}
