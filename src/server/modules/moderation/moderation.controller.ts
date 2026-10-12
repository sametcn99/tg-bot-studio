import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';

/**
 * Banned user management endpoints backing the moderation module UI.
 */
@Controller('bots/:botId/moderation')
export class ModerationController {
  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {EngineHelpersService} helpers - Shared audience operations.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly helpers: EngineHelpersService,
  ) {}

  /**
   * Lists banned users for the bot.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Banned user rows.
   */
  @Get('blocked')
  blocked(@Param('botId', ParseIntPipe) botId: number) {
    return this.db.query(
      'SELECT * FROM blocked_users WHERE bot_id = ? ORDER BY blocked_at DESC',
      botId,
    );
  }

  /**
   * Manually bans a user studio-wide for the bot.
   * @param {number} botId - Owning bot id.
   * @param {object} body - `{ telegramId, username?, firstName?, reason? }`.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Post('blocked')
  block(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    this.helpers.blockUser(
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
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('blocked/:telegramId')
  unblock(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('telegramId', ParseIntPipe) telegramId: number,
  ) {
    this.helpers.unblockUser(botId, telegramId);
    return { success: true };
  }

  /**
   * Lists known groups and channels for the bot.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Group rows.
   */
  @Get('groups')
  groups(@Param('botId', ParseIntPipe) botId: number) {
    return this.db.query(
      'SELECT * FROM bot_groups WHERE bot_id = ? ORDER BY is_active DESC, title',
      botId,
    );
  }
}
