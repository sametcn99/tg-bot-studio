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
  async listConnections(botId: string): Promise<ChatConnection[]> {
    return this.prisma.chatConnection.findMany({
      where: { botId },
      orderBy: [{ type: 'asc' }, { title: 'asc' }],
    });
  }

  /**
   * Finds a connection by botId and numeric primary key id.
   */
  async findConnectionById(botId: string, id: string): Promise<ChatConnection | null> {
    return this.prisma.chatConnection.findFirst({
      where: { botId, id },
    });
  }

  /**
   * Finds a connection by botId and chatId string.
   */
  async findConnectionByChatId(botId: string, chatId: string): Promise<ChatConnection | null> {
    return this.prisma.chatConnection.findUnique({
      where: {
        botId_chatId: { botId, chatId },
      },
    });
  }

  /**
   * Alias for findConnectionByChatId.
   */
  async findByChatId(botId: string, chatId: string): Promise<ChatConnection | null> {
    return this.findConnectionByChatId(botId, chatId);
  }

  /**
   * Creates a chat connection.
   */
  async createConnection(data: {
    botId: string;
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
    id: string,
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
  async deleteConnection(id: string): Promise<void> {
    await this.prisma.chatConnection.delete({
      where: { id },
    });
  }

  /**
   * Counts active connections for a bot.
   */
  async countActiveConnections(botId: string): Promise<number> {
    return this.prisma.chatConnection.count({
      where: { botId, isActive: 1 },
    });
  }

  /**
   * Lists discovered bot groups for a bot.
   */
  async listGroups(botId: string): Promise<BotGroupEntity[]> {
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
   * Upserts a discovered bot group and mirrors it to ChatConnection.
   */
  async upsertGroup(data: {
    botId: string;
    chatId: number | bigint | string;
    title: string;
    type: string;
    username?: string | null;
    isActive?: number;
  }): Promise<BotGroup> {
    const chatId = BigInt(data.chatId);
    const chatIdStr = data.chatId.toString();
    const group = await this.prisma.botGroup.upsert({
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

    try {
      await this.prisma.chatConnection.upsert({
        where: {
          botId_chatId: { botId: data.botId, chatId: chatIdStr },
        },
        create: {
          botId: data.botId,
          chatId: chatIdStr,
          title: data.title,
          type: data.type,
          username: data.username ?? null,
          isActive: data.isActive ?? 1,
          createdAt: new Date().toISOString(),
        },
        update: {
          title: data.title,
          type: data.type,
          ...(data.username !== undefined ? { username: data.username } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
    } catch {
      // Ignore mirror errors
    }

    return group;
  }
}
