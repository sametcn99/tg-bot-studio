import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';

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

/** Auto-sync interval for discovered chats (30 seconds). */
const AUTO_SYNC_INTERVAL_MS = 30_000;

/** Extracted row shape of the auto-tracked `bot_groups` table. */
interface BotGroupRow {
  chat_id: number;
  title: string;
  type: string;
  is_active: number;
}

/** Minimal chat payload returned by `getChat` enrichment. */
interface DiscoveredChatInfo {
  title?: string;
  username?: string;
  type?: string;
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
 * target-chat dropdown in the studio. Chats the bot operates in are learned
 * by the engine automatically and imported into the address book by a
 * 30-second auto-sync ticker (configurable per bot), so the list stays
 * current without any manual action.
 */
@Injectable()
export class ConnectionsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ConnectionsService.name);
  private readonly ticker: ReturnType<typeof setInterval>;

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool (getChat enrichment).
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
  ) {
    this.ticker = setInterval(() => {
      void this.autoSyncAll().catch((error: Error) =>
        this.logger.error(`Auto-sync failed: ${error.message}`),
      );
    }, AUTO_SYNC_INTERVAL_MS);
  }

  /**
   * Runs one auto-sync pass right after boot so the address book is fresh.
   * @returns {Promise<void>} Resolves once the first pass completes.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.autoSyncAll().catch(() => undefined);
  }

  /**
   * Stops the auto-sync ticker on shutdown.
   * @returns {void}
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

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
   * Reads the per-bot auto-sync flag from the connections module config.
   * @param {number} botId - Owning bot id.
   * @returns {boolean} True when discovered chats should import automatically.
   */
  private autoSyncEnabled(botId: number): boolean {
    const row = this.db.get<{ config_json: string | null }>(
      "SELECT config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'connections'",
      botId,
    );
    if (!row?.config_json) return true;
    const config = JSON.parse(row.config_json) as Record<string, unknown>;
    return config.autoSync !== false;
  }

  /**
   * Imports discovered chats for every bot whose auto-sync stays enabled.
   * @returns {Promise<void>} Resolves once all bots were processed.
   */
  private async autoSyncAll(): Promise<void> {
    const bots = this.db.query<{ id: number }>('SELECT id FROM bots');
    for (const bot of bots) {
      if (!this.autoSyncEnabled(bot.id)) continue;
      await this.syncFromBot(bot.id, true).catch((error: Error) =>
        this.logger.warn(`Auto-sync skipped for bot ${bot.id}: ${error.message}`),
      );
    }
  }

  /**
   * Imports every chat the bot runtime auto-discovered (bot_groups) into the
   * connection list, refreshing titles and active state of known rows.
   * New rows are enriched through `getChat` when the bot runtime is online.
   * Manual deactivation wins: only rows the bot actually left are deactivated.
   * @param {number} botId - Owning bot id.
   * @param {boolean} [enrich] - Fetch fresh chat info for newly discovered rows.
   * @returns {Promise<{synced: number}>} Number of chats processed.
   */
  async syncFromBot(botId: number, enrich = false): Promise<{ synced: number }> {
    const groups = this.db.query<BotGroupRow>(
      'SELECT chat_id, title, type, is_active FROM bot_groups WHERE bot_id = ?',
      botId,
    );
    for (const group of groups) {
      const chatId = String(group.chat_id);
      const known = this.db.get(
        'SELECT 1 FROM chat_connections WHERE bot_id = ? AND chat_id = ?',
        botId,
        chatId,
      );
      let title = group.title;
      let type = normalizeType(group.type);
      let username: string | null = null;
      if (!known && enrich) {
        const info = await this.fetchChatInfo(botId, chatId);
        if (info) {
          title = info.title || title;
          type = normalizeType(info.type ?? type);
          username = info.username ?? null;
        }
      }
      this.db.run(
        `INSERT INTO chat_connections (bot_id, chat_id, title, type, username, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, chat_id) DO UPDATE SET
           title = excluded.title, type = excluded.type,
           is_active = CASE WHEN excluded.is_active = 0 THEN 0 ELSE chat_connections.is_active END`,
        botId,
        chatId,
        title,
        type,
        username,
        group.is_active ? 1 : 0,
        new Date().toISOString(),
      );
    }
    return { synced: groups.length };
  }

  /**
   * Fetches title/username/type for a discovered chat through the running bot.
   * @param {number} botId - Owning bot id.
   * @param {string} chatId - Numeric chat id.
   * @returns {Promise<DiscoveredChatInfo | null>} Chat info, or null when the bot is offline/unreachable.
   */
  private async fetchChatInfo(botId: number, chatId: string): Promise<DiscoveredChatInfo | null> {
    const bot = this.pool.getBot(botId);
    if (!bot) return null;
    try {
      const info = (await bot.api.getChat(chatId)) as DiscoveredChatInfo;
      return { title: info.title, username: info.username, type: info.type };
    } catch {
      return null;
    }
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
