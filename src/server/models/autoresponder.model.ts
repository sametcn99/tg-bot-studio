import { Injectable } from '@nestjs/common';
import type { Autoresponder } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AutoresponderRow {
  id: number;
  bot_id: number;
  command: string;
  response_text: string;
  media_url: string | null;
  buttons_json: string | null;
  is_active: number;
  chat_id: string | null;
  scope: string;
  match_mode: string;
  admin_only: number;
  repeat_seconds: number;
  botId: number;
  responseText: string;
  mediaUrl: string | null;
  buttonsJson: string | null;
  isActive: number;
  chatId: string | null;
  matchMode: string;
  adminOnly: number;
  repeatSeconds: number;
}

export function toAutoresponderRow(item: Autoresponder): AutoresponderRow {
  return {
    id: item.id,
    bot_id: item.botId,
    command: item.command,
    response_text: item.responseText,
    media_url: item.mediaUrl,
    buttons_json: item.buttonsJson,
    is_active: item.isActive,
    chat_id: item.chatId,
    scope: item.scope,
    match_mode: item.matchMode,
    admin_only: item.adminOnly,
    repeat_seconds: item.repeatSeconds,
    botId: item.botId,
    responseText: item.responseText,
    mediaUrl: item.mediaUrl,
    buttonsJson: item.buttonsJson,
    isActive: item.isActive,
    chatId: item.chatId,
    matchMode: item.matchMode,
    adminOnly: item.adminOnly,
    repeatSeconds: item.repeatSeconds,
  };
}

/**
 * Model managing Autoresponder entities via Prisma.
 */
@Injectable()
export class AutoresponderModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists rules for a bot ordered by id.
   */
  async list(botId: number): Promise<Autoresponder[]> {
    return this.prisma.autoresponder.findMany({
      where: { botId },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Finds a rule by botId and id.
   */
  async findById(botId: number, id: number): Promise<Autoresponder | null> {
    return this.prisma.autoresponder.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Creates an autoresponder rule.
   */
  async create(data: {
    botId: number;
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
      },
    });
  }

  /**
   * Updates an autoresponder rule.
   */
  async update(
    id: number,
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
    },
  ): Promise<Autoresponder> {
    return this.prisma.autoresponder.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletes an autoresponder rule.
   */
  async delete(id: number): Promise<void> {
    await this.prisma.autoresponder.delete({
      where: { id },
    });
  }
}
