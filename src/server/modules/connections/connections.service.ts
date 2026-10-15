import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { ChatConnection } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ChatConnectionModel } from './chat-connection.model';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { StudioException } from '../../common/errors/studio-error';

/**
 * Connection row shape.
 */
export type ChatConnectionRow = ChatConnection;

/** Allowed connection type values. */
const CHAT_TYPES: readonly string[] = ['channel', 'group', 'supergroup'];

/** Auto-sync interval for discovered chats (30 seconds). */
const AUTO_SYNC_INTERVAL_MS = 30_000;

/** Minimal chat payload returned by `getChat` enrichment. */
interface DiscoveredChatInfo {
  title?: string;
  username?: string;
  type?: string;
}

/**
 * Normalizes a user-supplied chat reference.
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
 * Maps a chat type onto a valid connection type.
 */
function normalizeType(type: unknown): string {
  return CHAT_TYPES.includes(String(type)) ? String(type) : 'group';
}

/**
 * Chat Connections: the shared group/channel address book backing every
 * target-chat dropdown in the studio. Backed by ChatConnectionModel and Prisma.
 */
@Injectable()
export class ConnectionsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ConnectionsService.name);
  private readonly ticker: ReturnType<typeof setInterval>;

  /**
   * @param {ChatConnectionModel} connectionModel - Model for chat connections and groups.
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool (getChat enrichment).
   */
  constructor(
    private readonly connectionModel: ChatConnectionModel,
    private readonly prisma: PrismaService,
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
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.autoSyncAll().catch(() => undefined);
  }

  /**
   * Stops the auto-sync ticker on shutdown.
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Lists every connection of a bot.
   */
  async list(botId: number): Promise<ChatConnectionRow[]> {
    return this.connectionModel.listConnections(botId);
  }

  /**
   * Creates a connection.
   */
  async create(botId: number, data: Record<string, unknown>): Promise<ChatConnectionRow> {
    const chatId = normalizeChatId(data.chatId);
    const type = normalizeType(data.type);
    const title = String(data.title ?? '').trim() || chatId;

    const existing = await this.connectionModel.findConnectionByChatId(botId, chatId);
    if (existing) {
      throw new StudioException('CHAT_ALREADY_CONNECTED', `${chatId} is already connected`);
    }

    return this.connectionModel.createConnection({
      botId,
      chatId,
      title,
      type,
      username: data.username
        ? String(data.username).replace(/^@/, '')
        : chatId.startsWith('@')
          ? chatId.slice(1)
          : null,
      isActive: data.isActive === false ? 0 : 1,
    });
  }

  /**
   * Updates a connection.
   */
  async update(
    botId: number,
    id: number,
    data: Record<string, unknown>,
  ): Promise<ChatConnectionRow> {
    const existing = await this.getOrFail(botId, id);
    const chatId = data.chatId === undefined ? existing.chatId : normalizeChatId(data.chatId);

    if (chatId !== existing.chatId) {
      const duplicate = await this.connectionModel.findConnectionByChatId(botId, chatId);
      if (duplicate) {
        throw new StudioException('CHAT_ALREADY_CONNECTED', `${chatId} is already connected`);
      }
    }

    const username =
      data.username !== undefined
        ? data.username
          ? String(data.username).replace(/^@/, '')
          : null
        : existing.username;

    return this.connectionModel.updateConnection(id, {
      chatId,
      title: data.title === undefined ? existing.title : String(data.title).trim() || chatId,
      type: data.type === undefined ? existing.type : normalizeType(data.type),
      username,
      isActive: data.isActive === undefined ? existing.isActive : data.isActive ? 1 : 0,
    });
  }

  /**
   * Deletes a connection.
   */
  async remove(botId: number, id: number): Promise<void> {
    await this.getOrFail(botId, id);
    await this.connectionModel.deleteConnection(id);
  }

  /**
   * Reads the per-bot auto-sync flag from the connections module config.
   */
  private async autoSyncEnabled(botId: number): Promise<boolean> {
    const row = await this.prisma.botModule.findUnique({
      where: {
        botId_moduleKey: { botId, moduleKey: 'connections' },
      },
    });
    if (!row?.configJson) return true;
    const config = JSON.parse(row.configJson) as Record<string, unknown>;
    return config.autoSync !== false;
  }

  /**
   * Imports discovered chats for every bot whose auto-sync stays enabled.
   */
  private async autoSyncAll(): Promise<void> {
    const bots = await this.prisma.bot.findMany({ select: { id: true } });
    for (const bot of bots) {
      if (!(await this.autoSyncEnabled(bot.id))) continue;
      await this.syncFromBot(bot.id, true).catch((error: Error) =>
        this.logger.warn(`Auto-sync skipped for bot ${bot.id}: ${error.message}`),
      );
    }
  }

  /**
   * Imports every chat the bot runtime auto-discovered into the connection list.
   */
  async syncFromBot(botId: number, enrich = false): Promise<{ synced: number }> {
    const groups = await this.connectionModel.listGroups(botId);
    for (const group of groups) {
      const chatId = String(group.chat_id);
      const known = await this.connectionModel.findConnectionByChatId(botId, chatId);
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

      await this.prisma.chatConnection.upsert({
        where: {
          botId_chatId: { botId, chatId },
        },
        create: {
          botId,
          chatId,
          title,
          type,
          username,
          isActive: group.is_active ? 1 : 0,
          createdAt: new Date().toISOString(),
        },
        update: {
          title,
          type,
          isActive: group.is_active ? 1 : 0,
        },
      });
    }
    return { synced: groups.length };
  }

  /**
   * Fetches chat info via live bot instance.
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
   */
  private async getOrFail(botId: number, id: number): Promise<ChatConnectionRow> {
    const row = await this.connectionModel.findConnectionById(botId, id);
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    return row;
  }
}
