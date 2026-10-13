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
  botId: number;
  responseText: string;
  mediaUrl: string | null;
  buttonsJson: string | null;
  isActive: number;
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
    botId: item.botId,
    responseText: item.responseText,
    mediaUrl: item.mediaUrl,
    buttonsJson: item.buttonsJson,
    isActive: item.isActive,
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
  }): Promise<Autoresponder> {
    return this.prisma.autoresponder.create({
      data: {
        botId: data.botId,
        command: data.command,
        responseText: data.responseText,
        mediaUrl: data.mediaUrl ?? null,
        buttonsJson: data.buttonsJson ?? null,
        isActive: data.isActive ?? 1,
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
