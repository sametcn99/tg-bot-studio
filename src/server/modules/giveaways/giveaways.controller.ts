import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { GiveawaysService } from './giveaways.service';

/**
 * Giveaway management endpoints.
 */
@Controller('bots/:botId/giveaways')
export class GiveawaysController {
  /**
   * @param {GiveawaysService} service - Giveaway engine service.
   */
  constructor(private readonly service: GiveawaysService) {}

  /**
   * Lists giveaways with participant counts.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Giveaway rows.
   */
  @Get()
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Creates a giveaway.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - title, requiredChannels, winnersCount, prizeDetails, endsAt.
   * @returns {object} Created giveaway.
   */
  @Post()
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Updates a giveaway.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Giveaway identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {object} Updated giveaway.
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
   * Deletes a giveaway.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Giveaway identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    this.service.remove(botId, id);
    return { success: true };
  }

  /**
   * Lists participants of a giveaway.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Giveaway identifier.
   * @returns {number[]} Participant Telegram ids.
   */
  @Get(':id/participants')
  participants(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.participants(botId, id);
  }
}
