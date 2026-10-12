import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
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
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Schedules a post.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - targetChatId, messageText, mediaUrl, buttons, scheduledAt.
   * @returns {object} Created post row.
   */
  @Post()
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
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
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
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
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    this.service.remove(botId, id);
    return { success: true };
  }
}
