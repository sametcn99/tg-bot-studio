import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Menu item row in the `links` table backing the Start Menu module.
 * @interface MenuItemRow
 * @property {number} id - Item identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} title - Button label shown in the start menu.
 * @property {string} [description] - Optional description (sectioned style).
 * @property {string} url - Destination URL (t.me/addlist, channel, group, or web).
 * @property {string} type - `folder` | `channel` | `group` | `link`.
 * @property {number} order_index - Sort position.
 * @property {number} is_active - Visibility flag.
 * @property {number} click_count - Registered clicks.
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
 */
@Injectable()
export class StartMenuService {
  /**
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lists menu items for a bot ordered by position.
   * @param {number} botId - Owning bot id.
   * @returns {MenuItemRow[]} All menu items for the bot.
   */
  list(botId: number): MenuItemRow[] {
    return this.db.query<MenuItemRow>(
      'SELECT * FROM links WHERE bot_id = ? ORDER BY order_index ASC, id ASC',
      botId,
    );
  }

  /**
   * Creates a menu item.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - title, url, type, description, orderIndex.
   * @returns {MenuItemRow} Created row.
   */
  create(botId: number, data: Record<string, unknown>): MenuItemRow {
    const result = this.db.run(
      'INSERT INTO links (bot_id, title, description, url, type, order_index, is_active, click_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
      botId,
      String(data.title ?? ''),
      (data.description as string) ?? null,
      String(data.url ?? ''),
      String(data.type ?? 'link'),
      Number(data.orderIndex ?? 0),
      data.isActive === false ? 0 : 1,
      new Date().toISOString(),
    );
    return this.findOne(botId, Number(result.lastInsertRowid));
  }

  /**
   * Updates a menu item.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Item identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {MenuItemRow} Updated row.
   * @throws {NotFoundException} When the item does not exist.
   */
  update(botId: number, id: number, data: Record<string, unknown>): MenuItemRow {
    const existing = this.findOne(botId, id);
    this.db.run(
      'UPDATE links SET title = ?, description = ?, url = ?, type = ?, order_index = ?, is_active = ? WHERE id = ?',
      String(data.title ?? existing.title),
      (data.description as string) ?? existing.description,
      String(data.url ?? existing.url),
      String(data.type ?? existing.type),
      Number(data.orderIndex ?? existing.order_index),
      data.isActive === undefined ? existing.is_active : data.isActive ? 1 : 0,
      id,
    );
    return this.findOne(botId, id);
  }

  /**
   * Deletes a menu item.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Item identifier.
   * @returns {void}
   * @throws {NotFoundException} When the item does not exist.
   */
  remove(botId: number, id: number): void {
    this.findOne(botId, id);
    this.db.run('DELETE FROM links WHERE id = ?', id);
  }

  /**
   * Registers a click and returns the redirect target.
   * @param {number} id - Item identifier.
   * @returns {string | undefined} Destination URL when the item exists.
   */
  trackClick(id: number): string | undefined {
    const row = this.db.get<{ url: string }>('SELECT url FROM links WHERE id = ?', id);
    if (!row) return undefined;
    this.db.run('UPDATE links SET click_count = click_count + 1 WHERE id = ?', id);
    return row.url;
  }

  /**
   * Fetches a single menu item scoped to a bot.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Item identifier.
   * @returns {MenuItemRow} The item row.
   * @throws {NotFoundException} When not found.
   */
  findOne(botId: number, id: number): MenuItemRow {
    const row = this.db.get<MenuItemRow>(
      'SELECT * FROM links WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!row) throw new NotFoundException(`Menu item ${id} not found`);
    return row;
  }
}
