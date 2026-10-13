import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Outgoing webhook CRUD, delivery log access, and the public inbound
 * automation receiver (Zapier, Make, n8n, custom APIs).
 */
@Controller()
export class WebhooksController {
  /**
   * @param {WebhooksService} service - Webhooks hub service.
   */
  constructor(private readonly service: WebhooksService) {}

  /**
   * Lists outgoing endpoints.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Endpoint definitions.
   */
  @Get('bots/:botId/webhooks/endpoints')
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Creates an outgoing endpoint.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - url, secret, events.
   * @returns {object} Created endpoint.
   */
  @Post('bots/:botId/webhooks/endpoints')
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Deletes an outgoing endpoint.
   * @param {number} botId - Owning bot id.
   * @param {string} id - Endpoint identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('bots/:botId/webhooks/endpoints/:id')
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id') id: string) {
    this.service.remove(botId, id);
    return { success: true };
  }

  /**
   * Returns the recent delivery log.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Delivery entries.
   */
  @Get('bots/:botId/webhooks/log')
  log(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.deliveryLog(botId);
  }

  /**
   * Lists inbound hook actions.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Inbound actions.
   */
  @Get('bots/:botId/webhooks/inbound')
  listInbound(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.listInbound(botId);
  }

  /**
   * Creates an inbound hook action.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - targetChatId, template.
   * @returns {object} Created action with its receiver URL.
   */
  @Post('bots/:botId/webhooks/inbound')
  createInbound(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.createInbound(botId, body);
  }

  /**
   * Deletes an inbound hook action.
   * @param {number} botId - Owning bot id.
   * @param {string} hookId - Inbound hook identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('bots/:botId/webhooks/inbound/:hookId')
  removeInbound(@Param('botId', ParseIntPipe) botId: number, @Param('hookId') hookId: string) {
    this.service.removeInbound(botId, hookId);
    return { success: true };
  }

  /**
   * Public inbound receiver. External automations POST JSON here; the
   * matching action renders its template and sends the message.
   * @param {number} botId - Owning bot id.
   * @param {string} hookId - Inbound hook identifier.
   * @param {Request} req - Request carrying the JSON payload.
   * @returns {Promise<{success: boolean}>} Whether an action matched.
   * @throws {NotFoundException} When no action matches the hook id.
   */
  @Public()
  @Post('hooks/:botId/:hookId')
  @HttpCode(200)
  async inbound(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('hookId') hookId: string,
    @Req() req: Request,
  ) {
    const handled = await this.service.handleInbound(
      botId,
      hookId,
      (req.body ?? {}) as Record<string, unknown>,
    );
    if (!handled) throw new NotFoundException('Unknown hook');
    return { success: true };
  }
}
