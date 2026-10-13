import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { AutoresponderService } from './autoresponder.service';

/**
 * Custom commands & auto-responder rule CRUD.
 */
@Controller('bots/:botId/autoresponders')
export class AutoresponderController {
  /**
   * @param {AutoresponderService} service - Rule CRUD service.
   */
  constructor(private readonly service: AutoresponderService) {}

  /**
   * Lists every rule for the bot.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Rule rows.
   */
  @Get()
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Creates a rule.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - command, responseText, mediaUrl, buttons, isActive.
   * @returns {object} Created rule.
   */
  @Post()
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Updates a rule.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Rule identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {object} Updated rule.
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
   * Deletes a rule.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Rule identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    this.service.remove(botId, id);
    return { success: true };
  }
}
