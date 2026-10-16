import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MessageScoreService, type ScorePeriod } from './message-score.service';
import { ScorePayloadDto } from './dto/message-score.dto';

/**
 * Message Score & Activity Leaderboard endpoints: leaderboard reads,
 * previews, immediate sends, and schedule CRUD.
 */
@Controller('bots/:botId/message-score')
export class MessageScoreController {
  /**
   * @param {MessageScoreService} service - Score service.
   */
  constructor(private readonly service: MessageScoreService) {}

  /**
   * Returns the weighted activity leaderboard.
   * @param {number} botId - Owning bot id.
   * @param {string} [chatId] - Optional chat filter.
   * @param {string} [period] - daily/weekly/monthly/alltime.
   * @param {string} [limit] - Maximum rows.
   * @returns {object[]} Leaderboard entries.
   */
  @Get('leaderboard')
  leaderboard(
    @Param('botId', ParseIntPipe) botId: number,
    @Query('chatId') chatId?: string,
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.leaderboard(
      botId,
      chatId || undefined,
      this.toPeriod(period),
      Number(limit ?? 10),
    );
  }

  /**
   * Renders the leaderboard message for the requested chats without sending.
   * @param {number} botId - Owning bot id.
   * @param {ScorePayloadDto} body - chatIds, period, format fields.
   * @returns {object[]} Per-chat rendered previews.
   */
  @Post('preview')
  preview(@Param('botId', ParseIntPipe) botId: number, @Body() body: ScorePayloadDto) {
    return this.service.preview(botId, body as unknown as Record<string, unknown>);
  }

  /**
   * Sends the leaderboard message to the requested chats right away.
   * @param {number} botId - Owning bot id.
   * @param {ScorePayloadDto} body - chatIds, period, format fields.
   * @returns {Promise<object[]>} Per-chat delivery results.
   */
  @Post('send')
  send(@Param('botId', ParseIntPipe) botId: number, @Body() body: ScorePayloadDto) {
    return this.service.sendNow(botId, body as unknown as Record<string, unknown>);
  }

  /**
   * Lists scheduled leaderboard postings.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Schedule rows.
   */
  @Get('schedules')
  listSchedules(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.listSchedules(botId);
  }

  /**
   * Creates a scheduled leaderboard posting.
   * @param {number} botId - Owning bot id.
   * @param {ScorePayloadDto} body - Schedule payload.
   * @returns {object} Created schedule.
   */
  @Post('schedules')
  createSchedule(@Param('botId', ParseIntPipe) botId: number, @Body() body: ScorePayloadDto) {
    return this.service.createSchedule(botId, body as unknown as Record<string, unknown>);
  }

  /**
   * Updates a scheduled leaderboard posting.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Schedule identifier.
   * @param {ScorePayloadDto} body - Patch fields.
   * @returns {object} Updated schedule.
   */
  @Patch('schedules/:id')
  updateSchedule(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ScorePayloadDto,
  ) {
    return this.service.updateSchedule(botId, id, body as unknown as Record<string, unknown>);
  }

  /**
   * Deletes a scheduled leaderboard posting.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Schedule identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('schedules/:id')
  removeSchedule(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.service.removeSchedule(botId, id);
    return { success: true };
  }

  /**
   * Dispatches a scheduled leaderboard immediately.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Schedule identifier.
   * @returns {Promise<object>} Updated schedule.
   */
  @Post('schedules/:id/run')
  runSchedule(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.runScheduleNow(botId, id);
  }

  /**
   * Validates a period query parameter.
   * @param {string | undefined} value - Raw period.
   * @returns {ScorePeriod} Valid period.
   */
  private toPeriod(value: string | undefined): ScorePeriod {
    return value === 'daily' || value === 'monthly' || value === 'alltime' ? value : 'weekly';
  }
}
