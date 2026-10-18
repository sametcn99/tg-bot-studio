import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { TemplatesService } from './templates.service';

/**
 * Template gallery endpoints (studio-wide, not bot-scoped).
 */
@Controller('templates')
export class TemplatesController {
  /**
   * @param {TemplatesService} service - Template gallery service.
   */
  constructor(private readonly service: TemplatesService) {}

  /**
   * Lists saved templates with bundle summaries.
   * @returns {Promise<object[]>} Template rows.
   */
  @Get()
  list() {
    return this.service.list();
  }

  /**
   * Saves a template from an export bundle.
   * @param {Record<string, unknown>} body - name, description, bundle.
   * @returns {Promise<object>} Created template row.
   */
  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }

  /**
   * Downloads a template bundle (same JSON as bot export).
   * @param {number} id - Template id.
   * @returns {Promise<object>} The stored bundle.
   */
  @Get(':id/bundle')
  getBundle(@Param('id') id: string) {
    return this.service.getBundle(id);
  }

  /**
   * Deletes a template.
   * @param {number} id - Template id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

/**
 * Template application endpoint scoped to a target bot.
 */
@Controller('bots/:botId/templates')
export class TemplateApplyController {
  /**
   * @param {TemplatesService} service - Template gallery service.
   */
  constructor(private readonly service: TemplatesService) {}

  /**
   * Applies a template to the bot.
   * @param {number} botId - Target bot id.
   * @param {number} templateId - Template id.
   * @returns {Promise<object>} Import result.
   */
  @Post(':templateId/apply')
  apply(@Param('botId') botId: string, @Param('templateId') templateId: string) {
    return this.service.apply(botId, templateId);
  }
}
