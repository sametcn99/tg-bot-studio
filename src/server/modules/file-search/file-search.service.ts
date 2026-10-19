import { Injectable } from '@nestjs/common';
import type { Message, User } from 'grammy/types';
import { GroupFileIndexModel } from './group-file-index.model';
import { BotModel } from '../../bots/bot.model';
import { LiveEventsService } from '../../common/live/live-events.service';
import { displayName } from '../../common/utils/telegram-text.util';
import { extractMedia, matchFiles, normalizeForSearch } from './search-logic';

/** JSON-safe dashboard row shape (BigInt ids serialized as strings). */
export interface FileIndexRow {
  id: string;
  chatId: string;
  messageId: number;
  kind: string;
  fileName: string | null;
  caption: string | null;
  mimeType: string | null;
  fileSize: number | null;
  senderId: string | null;
  senderName: string | null;
  sentAt: string | null;
}

/** Cap before the in-memory cooldown map gets pruned of stale entries. */
const COOLDOWN_MAP_PRUNE_SIZE = 5_000;

/** Entries younger than this survive a prune sweep. */
const COOLDOWN_KEEP_MS = 60_000;

/**
 * Group file-search service: indexes media messages of targeted chats into
 * `group_file_index`, runs token matching over one chat's index, backs the
 * dashboard file list, and tracks the per-user/per-chat answer cooldowns in
 * memory.
 */
@Injectable()
export class FileSearchService {
  /** `${botId}:${chatId}` / `${botId}:${chatId}:${userId}` → last answer ms. */
  private readonly cooldowns = new Map<string, number>();

  /**
   * @param {GroupFileIndexModel} indexModel - Index persistence model.
   * @param {BotModel} botModel - Bot existence checks.
   * @param {LiveEventsService} live - Live change bus for SSE pings.
   */
  constructor(
    private readonly indexModel: GroupFileIndexModel,
    private readonly botModel: BotModel,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Indexes one media message (no-op for text-only, sticker, or media with
   * neither a filename nor a caption to search).
   *
   * @param {string} botId - Studio bot id.
   * @param {number} chatId - Telegram chat id.
   * @param {Message} msg - Media message.
   * @param {boolean} includeCaptions - Whether captions join the search text.
   * @returns {Promise<boolean>} True when a row was written.
   */
  async indexMessage(
    botId: string,
    chatId: number,
    msg: Message,
    includeCaptions: boolean,
  ): Promise<boolean> {
    const media = extractMedia(msg);
    if (!media || !media.fileId) return false;
    const caption = msg.caption?.trim() || null;
    const fileName = media.fileName?.trim() || null;
    if (!fileName && !caption) return false;

    const searchText = normalizeForSearch(
      [fileName, includeCaptions ? caption : null].filter(Boolean).join(' '),
    );
    if (!searchText) return false;

    await this.indexModel.indexMessage({
      botId,
      chatId: String(chatId),
      messageId: msg.message_id,
      kind: media.kind,
      fileName,
      caption,
      mimeType: media.mimeType,
      fileSize: media.fileSize,
      fileId: media.fileId,
      senderId: msg.from ? BigInt(msg.from.id) : null,
      senderName: msg.from ? displayName(msg.from as User) : null,
      sentAt: new Date(msg.date * 1000).toISOString(),
      searchText,
    });
    return true;
  }

  /**
   * Runs token matching over one chat's index (rows are pre-ordered newest
   * first; matching happens in JS against the folded `search_text`). The
   * full match list is returned — the runtime caps and counts remainders.
   *
   * @param {string} botId - Studio bot id.
   * @param {number} chatId - Telegram chat id.
   * @param {string[]} tokens - Normalized query tokens.
   * @param {'all'|'any'} mode - Match mode.
   * @returns {Promise<import('@prisma/client').GroupFileIndex[]>} Matches, newest first.
   */
  async search(botId: string, chatId: number, tokens: string[], mode: 'all' | 'any') {
    const rows = await this.indexModel.listForChat(botId, String(chatId));
    return matchFiles(rows, tokens, mode);
  }

  /**
   * Lists indexed files for the dashboard with optional filters.
   *
   * @param {string} botId - Studio bot id.
   * @param {object} [filters] - Optional chatId / q / kind filters.
   * @param {string} filters.chatId - Telegram chat id filter.
   * @param {string} filters.q - Free-text filter (normalized here).
   * @param {string} filters.kind - Media kind filter.
   * @returns {Promise<FileIndexRow[]>} Rows, newest first.
   */
  async list(
    botId: string,
    filters: { chatId?: string; q?: string; kind?: string } = {},
  ): Promise<FileIndexRow[]> {
    await this.botModel.findById(botId);
    const rows = await this.indexModel.listFiltered(botId, {
      chatId: filters.chatId,
      kind: filters.kind,
      q: filters.q ? normalizeForSearch(filters.q) : undefined,
    });
    return rows.map((row) => ({
      id: row.id,
      chatId: row.chatId,
      messageId: row.messageId,
      kind: row.kind,
      fileName: row.fileName,
      caption: row.caption,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      senderId: row.senderId === null ? null : row.senderId.toString(),
      senderName: row.senderName,
      sentAt: row.sentAt,
    }));
  }

  /**
   * Deletes one indexed row (dashboard maintenance).
   *
   * @param {string} botId - Studio bot id.
   * @param {string} id - Row id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  async remove(botId: string, id: string) {
    await this.indexModel.remove(botId, id);
    this.live.emit('file-index', botId);
    return { success: true };
  }

  /**
   * Whether a cooldown key is still inside its window.
   * @param {string} key - Cooldown key.
   * @param {number} seconds - Window length in seconds.
   * @returns {boolean} True when still cooling down.
   */
  isCooling(key: string, seconds: number): boolean {
    const last = this.cooldowns.get(key);
    return last !== undefined && Date.now() - last < seconds * 1000;
  }

  /**
   * Marks a key as just answered and prunes stale entries once the map grows.
   * @param {string} key - Cooldown key.
   * @returns {void}
   */
  markAnswered(key: string): void {
    this.cooldowns.set(key, Date.now());
    if (this.cooldowns.size < COOLDOWN_MAP_PRUNE_SIZE) return;
    const cutoff = Date.now() - COOLDOWN_KEEP_MS;
    for (const [entry, at] of this.cooldowns) {
      if (at < cutoff) this.cooldowns.delete(entry);
    }
  }
}
