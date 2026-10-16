import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ChatSettingsService } from '../bot-engine/chat-settings.service';
import { findModule } from '../bot-engine/module-registry';

/**
 * Per-chat module override endpoints powering the dashboard's per-group and
 * per-channel editors. Overrides merge on top of bot-level module config;
 * effective values apply to the live chat within the ChatSettingsService
 * cache TTL.
 */
@Controller('bots/:botId')
export class ChatSettingsController {
  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {ChatSettingsService} chatSettings - Per-chat settings layer.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSettings: ChatSettingsService,
  ) {}

  /**
   * Lists every chat that has an override for one module (module page chips).
   *
   * @param {number} botId - Owning bot id.
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<object[]>} Rows of `{ chatId, override }` per chat.
   */
  @Get('modules/:moduleKey/chat-overrides')
  async listForModule(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('moduleKey') moduleKey: string,
  ) {
    this.assertChatScoped(moduleKey);
    const rows = await this.prisma.chatModuleSetting.findMany({
      where: { botId, moduleKey },
      orderBy: { chatId: 'asc' },
    });
    return rows.map((row) => ({
      chatId: row.chatId,
      override: row.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : {},
    }));
  }

  /**
   * Reads one chat's override snapshot, the effective values (bot defaults
   * merged under the override), and whether anything is overridden.
   *
   * @param {number} botId - Owning bot id.
   * @param {string} chatId - Telegram chat id (numeric form).
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<object>} `{ moduleKey, chatId, override, effective, overridden }`.
   */
  @Get('chat-settings/:chatId/:moduleKey')
  async read(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('chatId') chatId: string,
    @Param('moduleKey') moduleKey: string,
  ) {
    this.assertChatScoped(moduleKey);
    this.assertNumericChatId(chatId);
    const override = (await this.chatSettings.getOverride(botId, chatId, moduleKey)) ?? {};
    const effective = await this.chatSettings.getEffectiveConfig(botId, chatId, moduleKey);
    return {
      moduleKey,
      chatId,
      override,
      effective,
      overridden: Object.keys(override).length > 0,
    };
  }

  /**
   * Saves a chat-level override (replaces the previous one wholesale).
   *
   * @param {number} botId - Owning bot id.
   * @param {string} chatId - Telegram chat id (numeric form).
   * @param {string} moduleKey - Module registry key.
   * @param {Record<string, unknown>} body - Override fields to persist.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Put('chat-settings/:chatId/:moduleKey')
  async save(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('chatId') chatId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertChatScoped(moduleKey);
    this.assertNumericChatId(chatId);
    this.assertOverrideFields(moduleKey, body ?? {});
    await this.chatSettings.setOverride(botId, chatId, moduleKey, body ?? {});
    return { success: true };
  }

  /**
   * Removes a chat-level override so the chat falls back to bot defaults.
   *
   * @param {number} botId - Owning bot id.
   * @param {string} chatId - Telegram chat id (numeric form).
   * @param {string} moduleKey - Module registry key.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete('chat-settings/:chatId/:moduleKey')
  async clear(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('chatId') chatId: string,
    @Param('moduleKey') moduleKey: string,
  ) {
    this.assertChatScoped(moduleKey);
    this.assertNumericChatId(chatId);
    await this.chatSettings.clearOverride(botId, chatId, moduleKey);
    return { success: true };
  }

  /**
   * Rejects module keys whose runtime never reads per-chat config, so the
   * API cannot store overrides that would silently do nothing.
   *
   * @param {string} moduleKey - Module registry key.
   * @returns {void}
   */
  private assertChatScoped(moduleKey: string): void {
    if (!findModule(moduleKey)?.chatScoped) {
      throw new BadRequestException(`Module "${moduleKey}" does not support per-chat settings.`);
    }
  }

  /**
   * Registry-driven field whitelist: an override may only set keys the module
   * actually defines (defaultConfig). Previously an arbitrary JSON blob could
   * be persisted and would ride along in every effective-config merge.
   *
   * @param {string} moduleKey - Module registry key.
   * @param {Record<string, unknown>} body - Submitted override fields.
   * @returns {void}
   */
  private assertOverrideFields(moduleKey: string, body: Record<string, unknown>): void {
    const definition = findModule(moduleKey);
    if (!definition) return; // assertChatScoped already rejected unknown modules
    const allowed = new Set(Object.keys(definition.defaultConfig ?? {}));
    const unknown = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown override field(s) for "${moduleKey}": ${unknown.join(', ')}`,
      );
    }
  }

  /**
   * Rejects username chat ids: Telegram update events only address numeric
   * chat ids, so a `@username` override could never be applied.
   *
   * @param {string} chatId - Chat id from the URL.
   * @returns {void}
   */
  private assertNumericChatId(chatId: string): void {
    if (!/^-?\d+$/.test(chatId)) {
      throw new BadRequestException(
        'Only numeric chat ids support per-chat settings. Sync the bot first.',
      );
    }
  }
}
