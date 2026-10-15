import { Injectable } from '@nestjs/common';
import type { BotGroup, ChatConnection } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { BotGroupEntity } from './chat-connection.entity';

/**
 * Model managing ChatConnection and BotGroup entities via Prisma.
 */
@Injectable()
export class ChatConnectionModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists connections for a bot ordered by type and title.
   */
  async listConnections(botId: number): Promise<ChatConnection[]> {
    return this.prisma.chatConnection.findMany({
      where: { botId },
      orderBy: [{ type: 'asc' }, { title: 'asc' }],
    });
  }

  /**
   * Finds a connection by botId and numeric primary key id.
   */
  async findConnectionById(botId: number, id: number): Promise<ChatConnection | null> {
    return this.prisma.chatConnection.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Finds a connection by botId and chatId string.
   */
  async findConnectionByChatId(botId: number, chatId: string): Promise<ChatConnection | null> {
    return this.prisma.chatConnection.findUnique({
      where: {
        botId_chatId: { botId, chatId },
      },
    });
  }

  /**
   * Alias for findConnectionByChatId.
   */
  async findByChatId(botId: number, chatId: string): Promise<ChatConnection | null> {
    return this.findConnectionByChatId(botId, chatId);
  }

  /**
   * Creates a chat connection.
   */
  async createConnection(data: {
    botId: number;
    chatId: string;
    title: string;
    type: string;
    username?: string | null;
    isActive?: number;
  }): Promise<ChatConnection> {
    return this.prisma.chatConnection.create({
      data: {
        botId: data.botId,
        chatId: data.chatId,
        title: data.title,
        type: data.type,
        username: data.username ?? null,
        isActive: data.isActive ?? 1,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Updates a chat connection.
   */
  async updateConnection(
    id: number,
    data: {
      chatId?: string;
      title?: string;
      type?: string;
      username?: string | null;
      isActive?: number;
    },
  ): Promise<ChatConnection> {
    return this.prisma.chatConnection.update({
      where: { id },
      data: {
        ...(data.chatId !== undefined ? { chatId: data.chatId } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.username !== undefined ? { username: data.username } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }

  /**
   * Deletes a chat connection.
   */
  async deleteConnection(id: number): Promise<void> {
    await this.prisma.chatConnection.delete({
      where: { id },
    });
  }

  /**
   * Counts active connections for a bot.
   */
  async countActiveConnections(botId: number): Promise<number> {
    return this.prisma.chatConnection.count({
      where: { botId, isActive: 1 },
    });
  }

  /**
   * Lists discovered bot groups for a bot.
   */
  async listGroups(botId: number): Promise<BotGroupEntity[]> {
    const rows = await this.prisma.botGroup.findMany({
      where: { botId },
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
    });
    return rows.map((r) => ({
      chat_id: Number(r.chatId),
      title: r.title,
      type: r.type,
      is_active: r.isActive,
    }));
  }

  /**
   * Upserts a discovered bot group.
   */
  async upsertGroup(data: {
    botId: number;
    chatId: number | bigint;
    title: string;
    type: string;
    isActive?: number;
  }): Promise<BotGroup> {
    const chatId = BigInt(data.chatId);
    return this.prisma.botGroup.upsert({
      where: {
        botId_chatId: { botId: data.botId, chatId },
      },
      create: {
        botId: data.botId,
        chatId,
        title: data.title,
        type: data.type,
        memberCount: 0,
        isActive: data.isActive ?? 1,
        createdAt: new Date().toISOString(),
      },
      update: {
        title: data.title,
        type: data.type,
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }
}
