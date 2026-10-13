import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Domain shape for chat history message.
 */
export interface AiChatHistoryMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Domain shape for AI knowledge doc.
 */
export interface AiKnowledgeDocEntity {
  id: number;
  bot_id: number;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
}

/**
 * Model managing AiChatHistory and AiKnowledgeDoc entities via Prisma.
 */
@Injectable()
export class AiModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads persisted conversation turns for a user from Prisma.
   */
  async getHistory(
    botId: number,
    telegramId: number | bigint,
    limit = 10,
  ): Promise<AiChatHistoryMessage[]> {
    const rows = await this.prisma.aiChatHistory.findMany({
      where: {
        botId,
        telegramId: BigInt(telegramId),
      },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        role: true,
        content: true,
      },
    });

    return rows.reverse().map((r) => ({
      role: r.role as 'system' | 'user' | 'assistant',
      content: r.content,
    }));
  }

  /**
   * Appends a message to persistent chat history.
   */
  async saveMessage(
    botId: number,
    telegramId: number | bigint,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    await this.prisma.aiChatHistory.create({
      data: {
        botId,
        telegramId: BigInt(telegramId),
        role,
        content,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Lists all knowledge documents for a bot.
   */
  async listDocs(botId: number): Promise<AiKnowledgeDocEntity[]> {
    const rows = await this.prisma.aiKnowledgeDoc.findMany({
      where: { botId },
      orderBy: { id: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      bot_id: r.botId,
      title: r.title,
      content: r.content,
      tags: r.tags,
      created_at: r.createdAt,
    }));
  }

  /**
   * Adds a new knowledge document.
   */
  async addDoc(
    botId: number,
    title: string,
    content: string,
    tags?: string,
  ): Promise<{ id: number }> {
    const created = await this.prisma.aiKnowledgeDoc.create({
      data: {
        botId,
        title,
        content,
        tags: tags ?? null,
        createdAt: new Date().toISOString(),
      },
    });
    return { id: created.id };
  }

  /**
   * Updates an existing knowledge document.
   */
  async updateDoc(
    botId: number,
    docId: number,
    title: string,
    content: string,
    tags?: string,
  ): Promise<void> {
    await this.prisma.aiKnowledgeDoc.updateMany({
      where: { botId, id: docId },
      data: {
        title,
        content,
        tags: tags ?? null,
      },
    });
  }

  /**
   * Deletes a knowledge document.
   */
  async removeDoc(botId: number, docId: number): Promise<void> {
    await this.prisma.aiKnowledgeDoc.deleteMany({
      where: { botId, id: docId },
    });
  }
}
