import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { EngagementService } from './engagement.service';

/**
 * Quiz management and engagement analytics endpoints.
 */
@Controller('bots/:botId/engagement')
export class EngagementController {
  /**
   * @param {EngagementService} service - Engagement service.
   */
  constructor(private readonly service: EngagementService) {}

  /**
   * Lists configured quizzes.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Quiz definitions.
   */
  @Get('quizzes')
  listQuizzes(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.listQuizzes(botId);
  }

  /**
   * Creates a quiz.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - question, options, correctOptionId, points.
   * @returns {object} Created quiz definition.
   */
  @Post('quizzes')
  createQuiz(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.createQuiz(botId, {
      question: String(body.question ?? ''),
      options: (body.options as string[]) ?? [],
      correctOptionId: Number(body.correctOptionId ?? 0),
      points: Number(body.points ?? 1),
    });
  }

  /**
   * Deletes a quiz and its scoreboard.
   * @param {number} botId - Owning bot id.
   * @param {string} quizId - Quiz identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('quizzes/:quizId')
  removeQuiz(@Param('botId', ParseIntPipe) botId: number, @Param('quizId') quizId: string) {
    this.service.removeQuiz(botId, quizId);
    return { success: true };
  }

  /**
   * Returns a quiz scoreboard.
   * @param {number} botId - Owning bot id.
   * @param {string} quizId - Quiz identifier.
   * @returns {Record<string, number>} Correct answers per Telegram id.
   */
  @Get('quizzes/:quizId/scoreboard')
  scoreboard(@Param('botId', ParseIntPipe) botId: number, @Param('quizId') quizId: string) {
    return this.service.getScoreboard(botId, quizId);
  }

  /**
   * Returns the reaction analytics summary.
   * @param {number} botId - Owning bot id.
   * @returns {Record<string, number>} Reaction emoji counts.
   */
  @Get('reactions/summary')
  reactionSummary(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.getReactionSummary(botId);
  }
}
