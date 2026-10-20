import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AutoresponderService, type AutoresponderRow } from './autoresponder.service';

function sanitizeRuleForApi(
  row: AutoresponderRow,
): Omit<AutoresponderRow, 'media_data' | 'mediaData'> {
  const sanitized = { ...row };
  delete sanitized.media_data;
  delete sanitized.mediaData;
  return sanitized;
}

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
   * @param {string} botId - Owning bot id.
   * @returns {Promise<object[]>} Rule rows.
   */
  @Get()
  async list(@Param('botId') botId: string) {
    const list = await this.service.list(botId);
    return list.map(sanitizeRuleForApi);
  }

  /**
   * Serves the media binary content or redirects to the external URL.
   */
  @Get(':id/media')
  async getMedia(@Param('botId') botId: string, @Param('id') id: string, @Res() res: Response) {
    const media = await this.service.getMediaFile(botId, id);
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (media.data) {
      res.setHeader('Content-Type', media.mime || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(media.data);
    }
    if (media.url) {
      return res.redirect(media.url);
    }
    throw new NotFoundException('Media not found');
  }

  /**
   * Creates a rule.
   * @param {string} botId - Owning bot id.
   * @param {Record<string, unknown>} body - command, responseText, mediaUrl, buttons, isActive.
   * @returns {Promise<object>} Created rule.
   */
  @Post()
  async create(@Param('botId') botId: string, @Body() body: Record<string, unknown>) {
    const item = await this.service.create(botId, body);
    return sanitizeRuleForApi(item);
  }

  /**
   * Updates a rule.
   * @param {string} botId - Owning bot id.
   * @param {string} id - Rule identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {Promise<object>} Updated rule.
   */
  @Patch(':id')
  async update(
    @Param('botId') botId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const item = await this.service.update(botId, id, body);
    return sanitizeRuleForApi(item);
  }

  /**
   * Deletes a rule.
   * @param {string} botId - Owning bot id.
   * @param {string} id - Rule identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete(':id')
  async remove(@Param('botId') botId: string, @Param('id') id: string) {
    await this.service.remove(botId, id);
    return { success: true };
  }
}
