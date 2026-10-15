import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';

/**
 * Per-connection (per-group) module configuration endpoints powering the
 * dashboard's group settings editor. Overrides merge on top of bot-level
 * module config; effective values apply to the live chat within the
 * ChatSettingsService cache TTL.
 */
@Controller('bots/:botId/connections/:id/settings')
export class ConnectionsSettingsController {
  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {ChatSettingsService} chatSettings - Per-chat settings layer.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSettings: ChatSettingsService,
  ) {}

  /**
   * Lists every module override set on this connection, plus effective
   * values and their source (chat override vs bot defaults).
   *
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @returns {Promise<object[]>} Per-module override/effective snapshots.
   */
  @Get()
  async list(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    const chatId = await this.resolveChatId(botId, id);
    const rows = await this.prisma.chatModuleSetting.findMany({
      where: { botId, chatId },
      orderBy: { moduleKey: 'asc' },
    });
    return rows.map((row) => {
      const config = JSON.parse(row.configJson) as Record<string, unknown>;
      return {
        moduleKey: row.moduleKey,
        chatId: row.chatId,
        override: config,
        overridden: Object.keys(config).length > 0,
      };
    });
  }

  /**
   * Reads one module's effective config for the connection.
   *
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<{moduleKey: string, config: Record<string, unknown>}>} Effective values.
   */
  @Get(':moduleKey')
  async read(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('moduleKey') moduleKey: string,
  ) {
    const chatId = await this.resolveChatId(botId, id);
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, moduleKey);
    return { moduleKey, config };
  }

  /**
   * Saves a module override for the connection.
   *
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @param {string} moduleKey - Module registry key.
   * @param {Record<string, unknown>} body - Override fields to persist.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Put(':moduleKey')
  async save(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('moduleKey') moduleKey: string,
    @Body() body: Record<string, unknown>,
  ) {
    const chatId = await this.resolveChatId(botId, id);
    await this.chatSettings.setOverride(botId, chatId, moduleKey, body ?? {});
    return { success: true };
  }

  /**
   * Clears a module override so the chat falls back to bot defaults.
   *
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete(':moduleKey')
  async clear(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('moduleKey') moduleKey: string,
  ) {
    const chatId = await this.resolveChatId(botId, id);
    await this.chatSettings.clearOverride(botId, chatId, moduleKey);
    return { success: true };
  }

  /**
   * Resolves a connection row to its Telegram chat id.
   *
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @returns {Promise<string>} Telegram chat id (numeric form).
   */
  private async resolveChatId(botId: number, id: number): Promise<string> {
    const row = await this.prisma.chatConnection.findFirst({ where: { id, botId } });
    if (!row) {
      throw new NotFoundException('Connection not found for this bot.');
    }
    // Numeric chat ids power per-chat settings; username rows cannot be
    // addressed by Telegram update events and stay non-overridable.
    if (!/^-?\d+$/.test(row.chatId)) {
      throw new BadRequestException(
        'Only numeric chat ids support per-group settings. Sync the bot first.',
      );
    }
    return row.chatId;
  }
}
