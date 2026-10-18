import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AiChatHistoryMessage, AiKnowledgeDocEntity } from './ai.entity';

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
    botId: string,
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
   * Appends a message to persistent chat history and returns its row id
   * (used to attach usage metrics afterwards).
   */
  async saveMessage(
    botId: string,
    telegramId: number | bigint,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<string> {
    const created = await this.prisma.aiChatHistory.create({
      data: {
        botId,
        telegramId: BigInt(telegramId),
        role,
        content,
        createdAt: new Date().toISOString(),
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Lists all knowledge documents for a bot.
   */
  async listDocs(botId: string): Promise<AiKnowledgeDocEntity[]> {
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
    botId: string,
    title: string,
    content: string,
    tags?: string,
  ): Promise<{ id: string }> {
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
    botId: string,
    docId: string,
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
  async removeDoc(botId: string, docId: string): Promise<void> {
    await this.prisma.aiKnowledgeDoc.deleteMany({
      where: { botId, id: docId },
    });
  }

  /**
   * Replaces the stored chunks of one document (used on re-index).
   */
  async replaceChunks(
    botId: string,
    docId: string,
    chunks: Array<{ idx: number; content: string; vectorJson?: string | null }>,
  ): Promise<void> {
    await this.prisma.aiKnowledgeChunk.deleteMany({ where: { botId, docId } });
    if (chunks.length === 0) return;
    const now = new Date().toISOString();
    await this.prisma.aiKnowledgeChunk.createMany({
      data: chunks.map((chunk) => ({
        botId,
        docId,
        idx: chunk.idx,
        content: chunk.content,
        vectorJson: chunk.vectorJson ?? null,
        createdAt: now,
      })),
    });
  }

  /**
   * Lists every chunk (with vectors) for a bot, oldest docs first.
   */
  async listChunks(botId: string): Promise<
    Array<{
      id: string;
      docId: string;
      idx: number;
      content: string;
      vectorJson: string | null;
    }>
  > {
    const rows = await this.prisma.aiKnowledgeChunk.findMany({
      where: { botId },
      orderBy: [{ docId: 'asc' }, { idx: 'asc' }],
      select: { id: true, docId: true, idx: true, content: true, vectorJson: true },
    });
    return rows;
  }

  /**
   * Number of indexed chunks for a bot (0 = semantic index missing).
   */
  async countChunks(botId: string): Promise<number> {
    return this.prisma.aiKnowledgeChunk.count({ where: { botId } });
  }

  /**
   * Records per-request AI usage metrics alongside the chat turn.
   */
  async recordMetrics(
    historyId: string | null,
    metrics: {
      promptTokens?: number;
      completionTokens?: number;
      latencyMs?: number;
      isError?: boolean;
    },
  ): Promise<void> {
    if (historyId === null) return;
    await this.prisma.aiChatHistory
      .update({
        where: { id: historyId },
        data: {
          promptTokens: metrics.promptTokens ?? null,
          completionTokens: metrics.completionTokens ?? null,
          latencyMs: metrics.latencyMs ?? null,
          isError: metrics.isError ?? false,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Aggregate AI usage for a bot over the trailing window (days).
   */
  async usageSummary(
    botId: string,
    days: number,
  ): Promise<{
    requests: number;
    errors: number;
    promptTokens: number;
    completionTokens: number;
    avgLatencyMs: number;
  }> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await this.prisma.aiChatHistory.findMany({
      where: { botId, createdAt: { gte: since } },
      select: {
        role: true,
        promptTokens: true,
        completionTokens: true,
        latencyMs: true,
        isError: true,
      },
    });
    const assistantTurns = rows.filter((row) => row.role === 'assistant');
    const promptTokens = assistantTurns.reduce((sum, row) => sum + (row.promptTokens ?? 0), 0);
    const completionTokens = assistantTurns.reduce(
      (sum, row) => sum + (row.completionTokens ?? 0),
      0,
    );
    const latencies = assistantTurns.map((row) => row.latencyMs ?? 0).filter((ms) => ms > 0);
    return {
      requests: assistantTurns.length,
      errors: assistantTurns.filter((row) => row.isError).length,
      promptTokens,
      completionTokens,
      avgLatencyMs:
        latencies.length > 0
          ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
          : 0,
    };
  }
}
