import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { DripService } from './drip.service';

/**
 * Drip campaign and subscriber management endpoints.
 */
@Controller('bots/:botId/drip')
export class DripController {
  /**
   * @param {DripService} service - Drip sequence service.
   */
  constructor(private readonly service: DripService) {}

  /**
   * Lists campaigns with subscriber counts.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Campaign rows.
   */
  @Get('campaigns')
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Creates a campaign.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - name, steps, isActive.
   * @returns {object} Created campaign.
   */
  @Post('campaigns')
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Updates a campaign.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Campaign identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {object} Updated campaign.
   */
  @Patch('campaigns/:id')
  update(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(botId, id, body);
  }

  /**
   * Deletes a campaign with its subscribers.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Campaign identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('campaigns/:id')
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    this.service.remove(botId, id);
    return { success: true };
  }

  /**
   * Lists subscribers of a campaign.
   * @param {number} botId - Owning bot id.
   * @param {number} campaignId - Campaign identifier.
   * @returns {object[]} Subscriber rows.
   */
  @Get('campaigns/:campaignId/subscribers')
  listSubscribers(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ) {
    return this.service.listSubscribers(botId, campaignId);
  }

  /**
   * Manually subscribes a user to a campaign.
   * @param {number} botId - Owning bot id.
   * @param {number} campaignId - Campaign identifier.
   * @param {object} body - `{ telegramId: number }`.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Post('campaigns/:campaignId/subscribers')
  subscribe(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('campaignId', ParseIntPipe) campaignId: number,
    @Body() body: { telegramId?: number },
  ) {
    this.service.subscribe(botId, campaignId, Number(body.telegramId));
    return { success: true };
  }

  /**
   * Removes a subscriber from a campaign.
   * @param {number} botId - Owning bot id.
   * @param {number} campaignId - Campaign identifier.
   * @param {number} telegramId - Subscriber Telegram id.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('campaigns/:campaignId/subscribers/:telegramId')
  unsubscribe(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('campaignId', ParseIntPipe) campaignId: number,
    @Param('telegramId', ParseIntPipe) telegramId: number,
  ) {
    this.service.unsubscribe(botId, campaignId, telegramId);
    return { success: true };
  }
}
