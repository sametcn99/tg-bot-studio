import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ConnectionsService } from './connections.service';

/**
 * Chat connection management endpoints backing the Connections module UI
 * and every target-chat dropdown across the studio.
 */
@Controller('bots/:botId/connections')
export class ConnectionsController {
  /**
   * @param {ConnectionsService} service - Connections service.
   */
  constructor(private readonly service: ConnectionsService) {}

  /**
   * Lists the bot's connected groups and channels.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Connection rows.
   */
  @Get()
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Adds a connection.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - title, type, chatId, username?, isActive?.
   * @returns {object} Created connection.
   */
  @Post()
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Imports chats the bot runtime already discovered.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<{synced: number}>} Number of chats processed.
   */
  @Post('sync')
  sync(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.syncFromBot(botId, true);
  }

  /**
   * Updates a connection.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {object} Updated connection.
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
   * Deletes a connection.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Connection identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    this.service.remove(botId, id);
    return { success: true };
  }
}
