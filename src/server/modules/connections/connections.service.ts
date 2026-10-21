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
 * Connection row shape exposing both camelCase and snake_case properties
 * for seamless compatibility across client components.
 */
export interface ChatConnectionRow {
  id: string;
  botId: string;
  bot_id: string;
  chatId: string;
  chat_id: string;
  title: string;
  type: string;
  username: string | null;
  isActive: number;
  is_active: number;
  createdAt: string | null;
  created_at: string | null;
}

export function toChatConnectionRow(item: ChatConnection): ChatConnectionRow {
  return {
    id: item.id,
    botId: item.botId,
    bot_id: item.botId,
    chatId: item.chatId,
    chat_id: item.chatId,
    title: item.title,
    type: item.type,
    username: item.username,
    isActive: item.isActive,
    is_active: item.isActive,
    createdAt: item.createdAt,
    created_at: item.createdAt,
  };
}

/** Allowed connection type values. */
const CHAT_TYPES: readonly string[] = ['channel', 'group', 'supergroup'];

/** Auto-sync interval for discovered chats (30 seconds). */
const AUTO_SYNC_INTERVAL_MS = 30_000;

/** Minimum delay between @username resolution attempts for one chat (10 minutes). */
const USERNAME_RESOLVE_RETRY_MS = 10 * 60_000;

/** Minimal chat payload returned by `getChat` enrichment. */
interface DiscoveredChatInfo {
  id?: string;
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
  private isRunning = false;
  /** Last @username resolution attempt per chat ref, throttling retries. */
  private readonly usernameAttempts = new Map<string, number>();

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
   * Lists every connection of a bot, ensuring any discovered groups are synced.
   */
  async list(botId: string): Promise<ChatConnectionRow[]> {
    await this.syncFromBot(botId, false).catch(() => undefined);
    const list = await this.connectionModel.listConnections(botId);
    return list.map(toChatConnectionRow);
  }

  /**
   * Creates a connection.
   */
  async create(botId: string, data: Record<string, unknown>): Promise<ChatConnectionRow> {
    const rawChatId = data.chatId !== undefined ? data.chatId : data.chat_id;
    let chatId = normalizeChatId(rawChatId);
    // Resolve @username refs to numeric ids via the live bot: per-chat module
    // settings only accept numeric ids, so an unresolved ref would stay
    // unconfigurable. Unresolvable refs (bot not in the chat yet) are kept
    // as-is and retried by the auto-sync pass.
    let resolvedInfo: DiscoveredChatInfo | null = null;
    if (chatId.startsWith('@')) {
      resolvedInfo = await this.fetchChatInfo(botId, chatId);
      if (resolvedInfo?.id) chatId = resolvedInfo.id;
    }
    const type = normalizeType(data.type);
    const title = String(data.title ?? '').trim() || resolvedInfo?.title || chatId;

    const existing = await this.connectionModel.findConnectionByChatId(botId, chatId);
    if (existing) {
      throw new StudioException('CHAT_ALREADY_CONNECTED', `${chatId} is already connected`);
    }

    const isActive =
      data.isActive !== undefined
        ? data.isActive === false || data.isActive === 0
          ? 0
          : 1
        : data.is_active !== undefined
          ? data.is_active === false || data.is_active === 0
            ? 0
            : 1
          : 1;

    const row = await this.connectionModel.createConnection({
      botId,
      chatId,
      title,
      type,
      username: data.username
        ? String(data.username).replace(/^@/, '')
        : (resolvedInfo?.username ?? (chatId.startsWith('@') ? chatId.slice(1) : null)),
      isActive,
    });

    if (/^-?\d+$/.test(chatId)) {
      try {
        await this.prisma.botGroup.upsert({
          where: { botId_chatId: { botId, chatId: BigInt(chatId) } },
          create: {
            botId,
            chatId: BigInt(chatId),
            title,
            type,
            memberCount: 0,
            isActive,
            createdAt: new Date().toISOString(),
          },
          update: {
            title,
            type,
            isActive,
          },
        });
      } catch {
        // Ignore
      }
    }

    return toChatConnectionRow(row);
  }

  /**
   * Updates a connection.
   */
  async update(
    botId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<ChatConnectionRow> {
    const existing = await this.getOrFail(botId, id);
    const rawChatId = data.chatId !== undefined ? data.chatId : data.chat_id;
    let chatId = rawChatId === undefined ? existing.chatId : normalizeChatId(rawChatId);
    if (chatId !== existing.chatId && chatId.startsWith('@')) {
      // Same numeric-id requirement as create: resolve when the live bot
      // knows the chat, otherwise keep the ref for the auto-sync retry.
      const info = await this.fetchChatInfo(botId, chatId);
      if (info?.id) chatId = info.id;
    }

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

    const isActive =
      data.isActive !== undefined
        ? data.isActive
          ? 1
          : 0
        : data.is_active !== undefined
          ? data.is_active
            ? 1
            : 0
          : existing.isActive;

    const targetType = data.type === undefined ? existing.type : normalizeType(data.type);
    const targetTitle =
      data.title === undefined ? existing.title : String(data.title).trim() || chatId;

    const row = await this.connectionModel.updateConnection(id, {
      chatId,
      title: targetTitle,
      type: targetType,
      username,
      isActive,
    });

    const idsToSync = new Set([chatId, existing.chatId].filter((cid) => /^-?\d+$/.test(cid)));
    for (const cid of idsToSync) {
      try {
        await this.prisma.botGroup.updateMany({
          where: { botId, chatId: BigInt(cid) },
          data: {
            type: targetType,
            title: targetTitle,
            isActive,
          },
        });
      } catch {
        // Ignore if not present in bot_groups
      }
    }

    return toChatConnectionRow(row);
  }

  /**
   * Deletes a connection.
   */
  async remove(botId: string, id: string): Promise<void> {
    const existing = await this.getOrFail(botId, id);
    await this.connectionModel.deleteConnection(id);
    if (/^-?\d+$/.test(existing.chatId)) {
      try {
        await this.prisma.botGroup.deleteMany({
          where: { botId, chatId: BigInt(existing.chatId) },
        });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Reads the per-bot auto-sync flag from the connections module config.
   */
  private async autoSyncEnabled(botId: string): Promise<boolean> {
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
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const bots = await this.prisma.bot.findMany({ select: { id: true } });
      for (const bot of bots) {
        if (!(await this.autoSyncEnabled(bot.id))) continue;
        await this.syncFromBot(bot.id, true).catch((error: Error) =>
          this.logger.warn(`Auto-sync skipped for bot ${bot.id}: ${error.message}`),
        );
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Imports every chat the bot runtime auto-discovered into the connection list.
   */
  async syncFromBot(botId: string, enrich = false): Promise<{ synced: number }> {
    const groups = await this.prisma.botGroup.findMany({
      where: { botId },
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
    });
    for (const group of groups) {
      const chatId = group.chatId.toString();
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

      if (known) {
        // Chat is already connected; preserve user-configured type, title, and isActive.
        // Enrich username only if missing.
        if (enrich && !known.username && username) {
          await this.prisma.chatConnection.update({
            where: { id: known.id },
            data: { username },
          });
        }
        continue;
      }

      await this.prisma.chatConnection.create({
        data: {
          botId,
          chatId,
          title,
          type,
          username,
          isActive: group.isActive ? 1 : 0,
          createdAt: new Date().toISOString(),
        },
      });
    }

    if (enrich) {
      await this.resolveUsernameConnections(botId);
    }
    return { synced: groups.length };
  }

  /**
   * Rewrites @username connection rows to their numeric chat ids once the
   * live bot can resolve them (bot joined the chat), so the numeric-only
   * per-chat module settings become available for those chats. Retries are
   * throttled per chat ref; a numeric twin row absorbs the duplicate.
   */
  private async resolveUsernameConnections(botId: string): Promise<void> {
    const rows = await this.prisma.chatConnection.findMany({ where: { botId } });
    for (const row of rows) {
      if (!row.chatId.startsWith('@')) continue;
      const attemptKey = `${botId}:${row.chatId}`;
      const lastAttempt = this.usernameAttempts.get(attemptKey) ?? 0;
      if (Date.now() - lastAttempt < USERNAME_RESOLVE_RETRY_MS) continue;
      this.usernameAttempts.set(attemptKey, Date.now());

      const info = await this.fetchChatInfo(botId, row.chatId);
      if (!info?.id) continue;
      try {
        const twin = await this.connectionModel.findConnectionByChatId(botId, info.id);
        if (twin && twin.id !== row.id) {
          await this.connectionModel.deleteConnection(row.id);
        } else {
          await this.connectionModel.updateConnection(row.id, {
            chatId: info.id,
            username: row.username ?? info.username ?? null,
          });
        }
        this.usernameAttempts.delete(attemptKey);
      } catch (error) {
        this.logger.warn(
          `Resolving ${row.chatId} to ${info.id} failed for bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Fetches chat info (numeric id, title, username, type) via live bot instance.
   */
  private async fetchChatInfo(botId: string, chatId: string): Promise<DiscoveredChatInfo | null> {
    const bot = this.pool.getBot(botId);
    if (!bot) return null;
    try {
      const info = (await bot.api.getChat(chatId)) as {
        id?: number | bigint;
        title?: string;
        username?: string;
        type?: string;
      };
      return {
        id: info.id !== undefined ? String(info.id) : undefined,
        title: info.title,
        username: info.username,
        type: info.type,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetches a single connection or throws.
   */
  private async getOrFail(botId: string, id: string): Promise<ChatConnectionRow> {
    const row = await this.connectionModel.findConnectionById(botId, id);
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    return toChatConnectionRow(row);
  }
}
