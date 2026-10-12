import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Support desk inbox endpoints for the dashboard.
 */
@Controller('bots/:botId/support')
export class SupportController {
  /**
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lists recent support messages (both directions).
   * @param {number} botId - Owning bot id.
   * @param {number} [limit=500] - Maximum rows returned.
   * @returns {object[]} Newest first message rows.
   */
  @Get('messages')
  messages(
    @Param('botId', ParseIntPipe) botId: number,
    @Query('limit') limit?: string,
  ) {
    const max = Math.min(2000, Math.max(1, Number(limit ?? 500)));
    return this.db.query(
      'SELECT * FROM support_messages WHERE bot_id = ? ORDER BY id DESC LIMIT ?',
      botId,
      max,
    );
  }

  /**
   * Lists conversation threads (one row per user with last activity).
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Threads with latest message preview.
   */
  @Get('threads')
  threads(@Param('botId', ParseIntPipe) botId: number) {
    return this.db.query(
      `SELECT telegram_id,
              MAX(sender_name) as sender_name,
              COUNT(*) as message_count,
              MAX(created_at) as last_activity,
              (SELECT message_text FROM support_messages sm2
                WHERE sm2.bot_id = sm.bot_id AND sm2.telegram_id = sm.telegram_id
                  AND sm2.id = MAX(sm.id)) as last_message
       FROM support_messages sm
       WHERE bot_id = ?
       GROUP BY telegram_id
       ORDER BY last_activity DESC`,
      botId,
    );
  }
}
