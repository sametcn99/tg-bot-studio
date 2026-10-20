import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookEndpointDto } from './dto/webhooks.dto';
import { Public } from '../../common/decorators/public.decorator';
import { StudioException } from '../../common/errors/studio-error';

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
  list(@Param('botId') botId: string) {
    return this.service.list(botId);
  }

  /**
   * Creates an outgoing endpoint.
   * @param {number} botId - Owning bot id.
   * @param {CreateWebhookEndpointDto} body - url, secret, events.
   * @returns {object} Created endpoint.
   */
  @Post('bots/:botId/webhooks/endpoints')
  create(@Param('botId') botId: string, @Body() body: CreateWebhookEndpointDto) {
    return this.service.create(botId, body as unknown as Record<string, unknown>);
  }

  /**
   * Deletes an outgoing endpoint.
   * @param {number} botId - Owning bot id.
   * @param {string} id - Endpoint identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('bots/:botId/webhooks/endpoints/:id')
  remove(@Param('botId') botId: string, @Param('id') id: string) {
    this.service.remove(botId, id);
    return { success: true };
  }

  /**
   * Returns the recent delivery log.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Delivery entries.
   */
  @Get('bots/:botId/webhooks/log')
  log(@Param('botId') botId: string) {
    return this.service.deliveryLog(botId);
  }

  /**
   * Lists inbound hook actions.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Inbound actions.
   */
  @Get('bots/:botId/webhooks/inbound')
  listInbound(@Param('botId') botId: string) {
    return this.service.listInbound(botId);
  }

  /**
   * Creates an inbound hook action.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - targetChatId, template.
   * @returns {object} Created action with its receiver URL.
   */
  @Post('bots/:botId/webhooks/inbound')
  createInbound(@Param('botId') botId: string, @Body() body: Record<string, unknown>) {
    return this.service.createInbound(botId, body);
  }

  /**
   * Deletes an inbound hook action.
   * @param {number} botId - Owning bot id.
   * @param {string} hookId - Inbound hook identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('bots/:botId/webhooks/inbound/:hookId')
  removeInbound(@Param('botId') botId: string, @Param('hookId') hookId: string) {
    this.service.removeInbound(botId, hookId);
    return { success: true };
  }

  /**
   * Public inbound receiver. External automations POST signed JSON here:
   * `X-Webhook-Signature: hex(hmac_sha256(actionSecret, rawBody))`. The
   * signature is mandatory (the secret is shown once when the hook is
   * created), ids are high-entropy, and each hook is rate limited.
   * @param {number} botId - Owning bot id.
   * @param {string} hookId - Inbound hook identifier.
   * @param {Request} req - Request carrying the JSON payload and signature.
   * @returns {Promise<{success: boolean}>} Whether an action matched.
   * @throws {StudioException} When the hook is unknown, throttled, or the signature is missing/invalid.
   */
  @Public()
  @Post('hooks/:botId/:hookId')
  @HttpCode(200)
  async inbound(
    @Param('botId') botId: string,
    @Param('hookId') hookId: string,
    @Req() req: Request,
  ) {
    if (!this.service.inboundRateAllowed(hookId)) {
      throw new StudioException('HOOK_THROTTLED', 'Too many requests for this hook');
    }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const verification = this.service.verifyInboundAction(
      botId,
      hookId,
      rawBody,
      req.headers['x-webhook-signature'] as string | undefined,
    );
    if (verification === 'unknown') {
      throw new StudioException('HOOK_UNKNOWN', 'Unknown hook');
    }
    if (verification === 'invalid') {
      throw new StudioException(
        'HOOK_SIGNATURE_INVALID',
        'Missing or invalid X-Webhook-Signature — sign the raw body with the hook secret',
      );
    }
    const handled = await this.service.handleInbound(
      botId,
      hookId,
      (req.body ?? {}) as Record<string, unknown>,
    );
    if (!handled) throw new StudioException('HOOK_UNKNOWN', 'Unknown hook');
    return { success: true };
  }
}
