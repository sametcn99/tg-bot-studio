import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Connection row in the `chat_connections` table.
 * @interface ChatConnectionRow
 * @property {number} id - Connection identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} chat_id - Numeric Telegram chat id (with leading `-100…`) or `@username`.
 * @property {string} title - Human-readable chat title.
 * @property {string} type - One of `channel`, `group`, `supergroup`.
 * @property {string | null} username - Public @username without the @, when known.
 * @property {number} is_active - Active flag.
 * @property {string | null} created_at - Creation timestamp.
 */
export interface ChatConnectionRow {
  id: number;
  bot_id: number;
  chat_id: string;
  title: string;
  type: string;
  username: string | null;
  is_active: number;
  created_at: string | null;
}

/** Allowed connection type values. */
const CHAT_TYPES: readonly string[] = ['channel', 'group', 'supergroup'];

/** Extracted row shape of the auto-tracked `bot_groups` table. */
interface BotGroupRow {
  chat_id: number;
  title: string;
  type: string;
  is_active: number;
}

/**
 * Normalizes a user-supplied chat reference: numeric ids pass through,
 * bare or @-prefixed usernames become canonical `@username` form.
 * @param {unknown} value - Raw input.
 * @returns {string} Normalized chat id.
 * @throws {BadRequestException} When the reference is neither a numeric id nor a username.
 */
function normalizeChatId(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (/^-?\d+$/.test(raw)) return raw;
  const username = raw.replace(/^@/, '');
  if (/^[A-Za-z0-9_]{4,}$/.test(username)) return `@${username}`;
  throw new BadRequestException(
    'chatId must be a numeric Telegram chat id (e.g. -1001234567890) or a @username',
  );
}

/**
 * Maps a grammY chat type onto a connection type, defaulting to `group`.
 * @param {unknown} type - Raw chat type.
 * @returns {string} One of the {@link CHAT_TYPES} values.
 */
function normalizeType(type: unknown): string {
  return CHAT_TYPES.includes(String(type)) ? String(type) : 'group';
}

/**
 * Chat Connections: the shared group/channel address book backing every
 * target-chat dropdown in the studio. Pure CRUD plus a one-click import
 * from the chats the bot runtime already discovered (`bot_groups`).
 */
@Injectable()
export class ConnectionsService {
  /**
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lists every connection of a bot.
   * @param {number} botId - Owning bot id.
   * @returns {ChatConnectionRow[]} Connection rows ordered by type then title.
   */
  list(botId: number): ChatConnectionRow[] {
    return this.db.query<ChatConnectionRow>(
      'SELECT * FROM chat_connections WHERE bot_id = ? ORDER BY type, title',
      botId,
    );
  }

  /**
   * Creates a connection.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - title, type, chatId, username?, isActive?.
   * @returns {ChatConnectionRow} Created row.
   * @throws {BadRequestException} When the chat id is malformed or duplicated.
   */
  create(botId: number, data: Record<string, unknown>): ChatConnectionRow {
    const chatId = normalizeChatId(data.chatId);
    const type = normalizeType(data.type);
    const title = String(data.title ?? '').trim() || chatId;
    if (this.db.get('SELECT 1 FROM chat_connections WHERE bot_id = ? AND chat_id = ?', botId, chatId)) {
      throw new BadRequestException(`${chatId} is already connected`);
    }
    const result = this.db.run(
      `INSERT INTO chat_connections (bot_id, chat_id, title, type, username, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      botId,
      chatId,
      title,
      type,
      data.username ? String(data.username).replace(/^@/, '') : chatId.startsWith('@') ? chatId.slice(1) : null,
      data.isActive === false ? 0 : 1,
      new Date().toISOString(),
    );
    return this.getOrFail(botId, Number(result.lastInsertRowid));
  }

  /**
   * Updates a connection.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {ChatConnectionRow} Updated row.
   * @throws {NotFoundException} When the connection does not exist.
   */
  update(botId: number, id: number, data: Record<string, unknown>): ChatConnectionRow {
    const existing = this.getOrFail(botId, id);
    const chatId = data.chatId === undefined ? existing.chat_id : normalizeChatId(data.chatId);
    if (
      chatId !== existing.chat_id &&
      this.db.get('SELECT 1 FROM chat_connections WHERE bot_id = ? AND chat_id = ?', botId, chatId)
    ) {
      throw new BadRequestException(`${chatId} is already connected`);
    }
    const username =
      data.username !== undefined
        ? data.username
          ? String(data.username).replace(/^@/, '')
          : null
        : existing.username;
    this.db.run(
      'UPDATE chat_connections SET chat_id = ?, title = ?, type = ?, username = ?, is_active = ? WHERE id = ?',
      chatId,
      data.title === undefined ? existing.title : String(data.title).trim() || chatId,
      data.type === undefined ? existing.type : normalizeType(data.type),
      username,
      data.isActive === undefined ? existing.is_active : data.isActive ? 1 : 0,
      id,
    );
    return this.getOrFail(botId, id);
  }

  /**
   * Deletes a connection.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @returns {void}
   * @throws {NotFoundException} When the connection does not exist.
   */
  remove(botId: number, id: number): void {
    this.getOrFail(botId, id);
    this.db.run('DELETE FROM chat_connections WHERE bot_id = ? AND id = ?', botId, id);
  }

  /**
   * Imports every chat the bot runtime auto-discovered (bot_groups) into the
   * connection list, refreshing titles and active state of known rows.
   * @param {number} botId - Owning bot id.
   * @returns {{synced: number}} Number of chats processed.
   */
  syncFromBot(botId: number): { synced: number } {
    const groups = this.db.query<BotGroupRow>(
      'SELECT chat_id, title, type, is_active FROM bot_groups WHERE bot_id = ?',
      botId,
    );
    for (const group of groups) {
      this.db.run(
        `INSERT INTO chat_connections (bot_id, chat_id, title, type, username, is_active, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(bot_id, chat_id) DO UPDATE SET
           title = excluded.title, type = excluded.type, is_active = excluded.is_active`,
        botId,
        String(group.chat_id),
        group.title,
        normalizeType(group.type),
        group.is_active ? 1 : 0,
        new Date().toISOString(),
      );
    }
    return { synced: groups.length };
  }

  /**
   * Fetches a single connection or throws.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @returns {ChatConnectionRow} The row.
   * @throws {NotFoundException} When the connection does not exist.
   */
  private getOrFail(botId: number, id: number): ChatConnectionRow {
    const row = this.db.get<ChatConnectionRow>(
      'SELECT * FROM chat_connections WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    return row;
  }
}
