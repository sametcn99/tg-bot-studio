import { Injectable } from '@nestjs/common';
import type { Autoresponder } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Model managing Autoresponder entities via Prisma.
 */
@Injectable()
export class AutoresponderModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists rules for a bot ordered by id.
   */
  async list(botId: string): Promise<Autoresponder[]> {
    return this.prisma.autoresponder.findMany({
      where: { botId },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Finds a rule by botId and id.
   */
  async findById(botId: string, id: string): Promise<Autoresponder | null> {
    return this.prisma.autoresponder.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Creates an autoresponder rule.
   */
  async create(data: {
    botId: string;
    command: string;
    responseText: string;
    mediaUrl?: string | null;
    buttonsJson?: string | null;
    isActive?: number;
    chatId?: string | null;
    scope?: string;
    matchMode?: string;
    adminOnly?: number;
    repeatSeconds?: number;
    deletePreviousResponse?: number;
    replyToMessage?: number;
    mediaData?: Buffer | Uint8Array | null;
    mediaMime?: string | null;
    mediaFileName?: string | null;
  }): Promise<Autoresponder> {
    return this.prisma.autoresponder.create({
      data: {
        botId: data.botId,
        command: data.command,
        responseText: data.responseText,
        mediaUrl: data.mediaUrl ?? null,
        buttonsJson: data.buttonsJson ?? null,
        isActive: data.isActive ?? 1,
        chatId: data.chatId ?? null,
        scope: data.scope ?? 'private',
        matchMode: data.matchMode ?? 'keyword',
        adminOnly: data.adminOnly ?? 0,
        repeatSeconds: data.repeatSeconds ?? 0,
        deletePreviousResponse: data.deletePreviousResponse ?? 0,
        replyToMessage: data.replyToMessage ?? 0,
        mediaData: (data.mediaData as unknown as Uint8Array<ArrayBuffer> | null) ?? null,
        mediaMime: data.mediaMime ?? null,
        mediaFileName: data.mediaFileName ?? null,
      },
    });
  }

  /**
   * Updates an autoresponder rule.
   */
  async update(
    id: string,
    data: {
      command?: string;
      responseText?: string;
      mediaUrl?: string | null;
      buttonsJson?: string | null;
      isActive?: number;
      chatId?: string | null;
      scope?: string;
      matchMode?: string;
      adminOnly?: number;
      repeatSeconds?: number;
      deletePreviousResponse?: number;
      replyToMessage?: number;
      mediaData?: Buffer | Uint8Array | null;
      mediaMime?: string | null;
      mediaFileName?: string | null;
    },
  ): Promise<Autoresponder> {
    const { mediaData, ...rest } = data;
    return this.prisma.autoresponder.update({
      where: { id },
      data: {
        ...rest,
        ...(mediaData !== undefined
          ? { mediaData: mediaData as unknown as Uint8Array<ArrayBuffer> | null }
          : {}),
      },
    });
  }

  /**
   * Deletes an autoresponder rule.
   */
  async delete(id: string): Promise<void> {
    await this.prisma.autoresponder.delete({
      where: { id },
    });
  }
}
