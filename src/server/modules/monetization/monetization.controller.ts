import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { MonetizationService } from './monetization.service';

/**
 * Paid media paywall and VIP subscription endpoints.
 */
@Controller('bots/:botId/monetization')
export class MonetizationController {
  /**
   * @param {MonetizationService} service - Monetization service.
   */
  constructor(private readonly service: MonetizationService) {}

  /**
   * Sends a Stars-locked paid media message.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - chatId, mediaType, mediaUrl, caption, starCount.
   * @returns {Promise<{messageId: number}>} Sent message identifier.
   */
  @Post('paid-media/send')
  sendPaidMedia(@Param('botId') botId: string, @Body() body: Record<string, unknown>) {
    return this.service.sendPaidMedia(botId, body);
  }

  /**
   * Grants a VIP subscription and sends the Star-priced invite link.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - telegramId, channelChatId, periodDays, starPrice.
   * @returns {Promise<{inviteLink: string; expiresAt: string}>} Link and expiry.
   */
  @Post('vip/grant')
  grantVip(@Param('botId') botId: string, @Body() body: Record<string, unknown>) {
    return this.service.grantVip(botId, body);
  }

  /**
   * Lists VIP subscriptions.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Subscription rows.
   */
  @Get('vip')
  listVip(@Param('botId') botId: string) {
    return this.service.listVip(botId);
  }

  /**
   * Revokes a VIP subscription and removes the member.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Subscription identifier.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete('vip/:id')
  async revokeVip(@Param('botId') botId: string, @Param('id') id: string) {
    await this.service.revokeVip(botId, id);
    return { success: true };
  }
}
