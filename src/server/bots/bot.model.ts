import { Injectable } from '@nestjs/common';
import type { Bot, BotModule } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Model representing Bot entities and per-bot module configuration.
 */
@Injectable()
export class BotModel {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds all bots ordered by id.
   */
  async findAll(): Promise<Bot[]> {
    return this.prisma.bot.findMany({
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Finds all active bots.
   */
  async findActiveBots(): Promise<Bot[]> {
    return this.prisma.bot.findMany({
      where: { isActive: 1 },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Finds a bot by primary key id.
   */
  async findById(id: number): Promise<Bot | null> {
    return this.prisma.bot.findUnique({
      where: { id },
    });
  }

  /**
   * Finds a bot by token.
   */
  async findByToken(token: string): Promise<Bot | null> {
    return this.prisma.bot.findUnique({
      where: { token },
    });
  }

  /**
   * Counts enabled modules for a bot.
   */
  async countActiveModules(botId: number): Promise<number> {
    return this.prisma.botModule.count({
      where: { botId, isEnabled: 1 },
    });
  }

  /**
   * Counts hosted mini apps for a bot.
   */
  async countMiniApps(botId: number): Promise<number> {
    return this.prisma.miniApp.count({
      where: { botId },
    });
  }

  /**
   * Counts subscribers in bot_users for a bot.
   */
  async countSubscribers(botId: number): Promise<number> {
    return this.prisma.botUser.count({
      where: { botId },
    });
  }

  /**
   * Creates a new bot.
   */
  async create(data: {
    name: string;
    token: string;
    username?: string | null;
    firstName?: string | null;
  }): Promise<Bot> {
    const now = new Date().toISOString();
    return this.prisma.bot.create({
      data: {
        name: data.name,
        token: data.token,
        username: data.username ?? null,
        firstName: data.firstName ?? null,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  /**
   * Updates an existing bot.
   */
  async update(id: number, data: { name?: string; isActive?: number }): Promise<Bot> {
    return this.prisma.bot.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Deletes a bot. Cascade delete on foreign keys will remove all associated bot rows.
   */
  async delete(id: number): Promise<void> {
    await this.prisma.bot.delete({
      where: { id },
    });
  }

  /**
   * Lists module records for a bot.
   */
  async listModules(botId: number): Promise<BotModule[]> {
    return this.prisma.botModule.findMany({
      where: { botId },
    });
  }

  /**
   * Finds a specific module record for a bot.
   */
  async getModule(botId: number, moduleKey: string): Promise<BotModule | null> {
    return this.prisma.botModule.findUnique({
      where: {
        botId_moduleKey: { botId, moduleKey },
      },
    });
  }

  /**
   * Checks whether a specific module is enabled for a bot.
   */
  async isModuleEnabled(botId: number, moduleKey: string): Promise<boolean> {
    const mod = await this.getModule(botId, moduleKey);
    return Boolean(mod?.isEnabled);
  }

  /**
   * Upserts module configuration and enabled state for a bot.
   */
  async upsertModule(
    botId: number,
    moduleKey: string,
    isEnabled: number,
    configJson?: string | null,
  ): Promise<BotModule> {
    return this.prisma.botModule.upsert({
      where: {
        botId_moduleKey: { botId, moduleKey },
      },
      create: {
        botId,
        moduleKey,
        isEnabled,
        configJson: configJson ?? null,
      },
      update: {
        isEnabled,
        ...(configJson !== undefined ? { configJson } : {}),
      },
    });
  }
}
