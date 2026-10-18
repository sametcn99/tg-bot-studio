import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

/**
 * Scheduled channel post CRUD endpoints.
 */
@Controller('bots/:botId/scheduler/posts')
export class SchedulerController {
  /**
   * @param {SchedulerService} service - Scheduler service.
   */
  constructor(private readonly service: SchedulerService) {}

  /**
   * Lists scheduled posts.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Post rows.
   */
  @Get()
  list(@Param('botId') botId: string) {
    return this.service.list(botId);
  }

  /**
   * Schedules posts. `targetChatId` accepts one chat id or an array of them
   * (multi-select picker); one post row is created per target chat.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - targetChatId (id or ids), messageText, mediaUrl, buttons, scheduledAt.
   * @returns {object[]} Created post rows.
   */
  @Post()
  create(@Param('botId') botId: string, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Updates a pending post.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Post identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {object} Updated post row.
   */
  @Patch(':id')
  update(
    @Param('botId') botId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(botId, id, body);
  }

  /**
   * Cancels a scheduled post.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Post identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId') botId: string, @Param('id') id: string) {
    this.service.remove(botId, id);
    return { success: true };
  }
}
