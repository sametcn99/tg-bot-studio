import { Injectable } from '@nestjs/common';
import type { GroupFileIndex } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BotScopedCrudModel } from '../../database/crud.model';

/**
 * Model managing the group file-search index via Prisma. Retrieval and
 * deletion live in the shared {@link BotScopedCrudModel} skeleton; indexing
 * and the per-chat search scan stay here because their filters are
 * module-specific.
 */
@Injectable()
export class GroupFileIndexModel extends BotScopedCrudModel<GroupFileIndex> {
  /** @param {PrismaService} prisma - Prisma ORM access service. */
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected override readonly delegate = this.prisma.groupFileIndex;

  protected override readonly defaultOrder: Record<string, 'asc' | 'desc'> = {
    sentAt: 'desc',
  };

  /**
   * Upserts one indexed media message (idempotent on the bot/chat/message
   * unique key, so re-delivered or edited captions simply refresh the row).
   *
   * @param {object} data - Index row fields.
   * @returns {Promise<GroupFileIndex>} Written row.
   */
  async indexMessage(data: {
    botId: string;
    chatId: string;
    messageId: number;
    kind: string;
    fileName?: string | null;
    caption?: string | null;
    mimeType?: string | null;
    fileSize?: number | null;
    fileId?: string | null;
    senderId?: bigint | null;
    senderName?: string | null;
    sentAt?: string | null;
    searchText: string;
  }): Promise<GroupFileIndex> {
    return this.prisma.groupFileIndex.upsert({
      where: {
        botId_chatId_messageId: {
          botId: data.botId,
          chatId: data.chatId,
          messageId: data.messageId,
        },
      },
      create: {
        botId: data.botId,
        chatId: data.chatId,
        messageId: data.messageId,
        kind: data.kind,
        fileName: data.fileName ?? null,
        caption: data.caption ?? null,
        mimeType: data.mimeType ?? null,
        fileSize: data.fileSize ?? null,
        fileId: data.fileId ?? null,
        senderId: data.senderId ?? null,
        senderName: data.senderName ?? null,
        sentAt: data.sentAt ?? null,
        searchText: data.searchText,
        createdAt: new Date().toISOString(),
      },
      update: {
        kind: data.kind,
        fileName: data.fileName ?? null,
        caption: data.caption ?? null,
        mimeType: data.mimeType ?? null,
        fileSize: data.fileSize ?? null,
        fileId: data.fileId ?? null,
        senderId: data.senderId ?? null,
        senderName: data.senderName ?? null,
        sentAt: data.sentAt ?? null,
        searchText: data.searchText,
      },
    });
  }

  /**
   * Loads every indexed row of one chat, newest first, for the runtime
   * matcher (matching itself runs in JS so Turkish-folded tokens compare
   * against the same-folded `search_text` column).
   *
   * @param {string} botId - Owning bot id.
   * @param {string} chatId - Telegram chat id.
   * @returns {Promise<GroupFileIndex[]>} Rows, newest first.
   */
  listForChat(botId: string, chatId: string): Promise<GroupFileIndex[]> {
    return this.prisma.groupFileIndex.findMany({
      where: { botId, chatId },
      orderBy: { sentAt: 'desc' },
    });
  }

  /**
   * Dashboard listing with optional filters. `q` is matched against the
   * normalized `search_text` column, so callers must normalize it first.
   *
   * @param {string} botId - Owning bot id.
   * @param {object} filters - Optional chatId / normalized q / kind filters.
   * @param {number} filters.chatId - Telegram chat id filter.
   * @param {string} filters.q - Normalized free-text filter.
   * @param {string} filters.kind - Media kind filter.
   * @param {number} take - Row cap.
   * @returns {Promise<GroupFileIndex[]>} Rows, newest first.
   */
  listFiltered(
    botId: string,
    filters: { chatId?: string; q?: string; kind?: string },
    take = 200,
  ): Promise<GroupFileIndex[]> {
    return this.prisma.groupFileIndex.findMany({
      where: {
        botId,
        ...(filters.chatId ? { chatId: filters.chatId } : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.q ? { searchText: { contains: filters.q } } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take,
    });
  }

  /**
   * Deletes an indexed row scoped to its bot.
   * @param {string} botId - Owning bot id.
   * @param {string} id - Row id.
   * @returns {Promise<void>} Resolves once removed.
   */
  async remove(botId: string, id: string): Promise<void> {
    await this.delete(botId, id, 'Indexed file');
  }
}
