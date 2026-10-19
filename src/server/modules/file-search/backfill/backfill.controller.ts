import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BackfillService } from './backfill.service';

/** Backfill start payload. */
interface BackfillBody {
  chatId?: string;
  accountId?: string;
  limit?: number;
}

/**
 * Retroactive file-search indexing endpoints for a bot.
 */
@Controller('bots/:botId/file-index/backfill')
export class BackfillController {
  /**
   * @param {BackfillService} backfill - Backfill job runner.
   */
  constructor(private readonly backfill: BackfillService) {}

  /**
   * Starts a backfill job with one of the bot's scan accounts.
   * @param {string} botId - Studio bot id.
   * @param {BackfillBody} body - chatId, accountId, limit (0 = all).
   * @returns {Promise<object>} Initial job state.
   */
  @Post()
  start(@Param('botId') botId: string, @Body() body: BackfillBody) {
    const chatId = String(body.chatId ?? '');
    const accountId = String(body.accountId ?? '');
    const limit = Number(body.limit ?? 0);
    if (!chatId || !accountId) {
      throw new BadRequestException('chatId and accountId are required');
    }
    return this.backfill.start(botId, chatId, accountId, limit);
  }

  /**
   * Current job snapshot.
   * @returns {object} Job state.
   */
  @Get('status')
  status() {
    return this.backfill.status();
  }

  /**
   * Cancels the running job.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Post('cancel')
  cancel() {
    return this.backfill.cancel();
  }
}
