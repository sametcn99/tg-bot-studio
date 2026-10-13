import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';
import { BotUserModel } from '../../models/bot-user.model';
import { ChatConnectionModel } from '../../models/chat-connection.model';

/**
 * Banned user management endpoints backing the moderation module UI.
 */
@Controller('bots/:botId/moderation')
export class ModerationController {
  /**
   * @param {BotUserModel} botUserModel - Audience & ban model.
   * @param {ChatConnectionModel} chatConnectionModel - Connection and group model.
   * @param {EngineHelpersService} helpers - Shared audience operations.
   */
  constructor(
    private readonly botUserModel: BotUserModel,
    private readonly chatConnectionModel: ChatConnectionModel,
    private readonly helpers: EngineHelpersService,
  ) {}

  /**
   * Lists banned users for the bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Banned user rows.
   */
  @Get('blocked')
  blocked(@Param('botId', ParseIntPipe) botId: number) {
    return this.botUserModel.listBlocked(botId);
  }

  /**
   * Manually bans a user studio-wide for the bot.
   * @param {number} botId - Owning bot id.
   * @param {object} body - `{ telegramId, username?, firstName?, reason? }`.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Post('blocked')
  async block(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    await this.helpers.blockUser(
      botId,
      {
        id: Number(body.telegramId),
        is_bot: false,
        first_name: String(body.firstName ?? 'User'),
        last_name: '',
        username: body.username ? String(body.username) : undefined,
      },
      String(body.reason ?? 'Manual ban from dashboard'),
    );
    return { success: true };
  }

  /**
   * Lifts a ban.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete('blocked/:telegramId')
  async unblock(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('telegramId', ParseIntPipe) telegramId: number,
  ) {
    await this.helpers.unblockUser(botId, telegramId);
    return { success: true };
  }

  /**
   * Lists known groups and channels for the bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Group rows.
   */
  @Get('groups')
  groups(@Param('botId', ParseIntPipe) botId: number) {
    return this.chatConnectionModel.listGroups(botId);
  }
}
