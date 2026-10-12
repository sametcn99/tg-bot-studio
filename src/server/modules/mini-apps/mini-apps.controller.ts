import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MiniAppsService } from './mini-apps.service';
import { toCsv } from '../../common/utils/csv.util';

/**
 * Dashboard-facing Mini App studio endpoints (CRUD, publish, orders, forms).
 */
@Controller('bots/:botId/mini-apps')
export class MiniAppsController {
  /**
   * @param {MiniAppsService} service - Mini App studio service.
   */
  constructor(private readonly service: MiniAppsService) {}

  /**
   * Lists Mini Apps for the bot.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} App rows with parsed config.
   */
  @Get()
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Creates a Mini App.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - name, slug, templateType, title, config, theme.
   * @returns {Promise<object>} Created app.
   */
  @Post()
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Updates a Mini App.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {Promise<object>} Updated app.
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
   * Deletes a Mini App.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    this.service.remove(botId, id);
    return { success: true };
  }

  /**
   * Publishes the app to the chat menu button.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @param {Record<string, unknown>} body - `{ publicBaseUrl: string }`.
   * @returns {Promise<{menuUrl: string}>} Configured menu button URL.
   */
  @Post(':id/publish')
  publish(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { publicBaseUrl?: string },
  ) {
    return this.service.publish(botId, id, body.publicBaseUrl ?? '');
  }

  /**
   * Lists orders for an app.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @returns {object[]} Order rows.
   */
  @Get(':id/orders')
  orders(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.listOrders(botId, id);
  }

  /**
   * Lists form submissions for an app, optionally serialized as CSV.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @param {string} [format] - Set to `csv` for a CSV document.
   * @returns {object[]|string} Submissions as JSON rows or a CSV document.
   */
  @Get(':id/forms')
  forms(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('format') format?: string,
  ) {
    const submissions = this.service.listFormSubmissions(botId, id);
    if (format !== 'csv') return submissions;
    const rows = submissions.map((entry) => {
      const answers = (entry as { answers?: Record<string, unknown> }).answers ?? {};
      return { telegramId: (entry as { telegramId?: number }).telegramId, ...answers };
    });
    return toCsv(rows);
  }
}
