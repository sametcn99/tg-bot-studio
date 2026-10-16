import { Body, Controller, Get, Header, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { UsersCrmService } from './users-crm.service';

/**
 * Audience CRM endpoints: subscriber listing, tag/note editing, and export.
 */
@Controller('bots/:botId/users')
export class UsersCrmController {
  /**
   * @param {UsersCrmService} crmService - CRM service.
   */
  constructor(private readonly crmService: UsersCrmService) {}

  /**
   * Lists subscribers with optional `search` and `tag` filters, evaluated
   * server-side with pagination: responds `{items, total, page, pageSize}`.
   * @param {number} botId - Owning bot id.
   * @param {string} [search] - Free-text match on username/name/id.
   * @param {string} [tag] - Required tag.
   * @param {string} [page] - 1-based page number.
   * @param {string} [pageSize] - Page size (default 50, max 200).
   * @returns {Promise<object>} Paginated subscriber page.
   */
  @Get()
  list(
    @Param('botId', ParseIntPipe) botId: number,
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.crmService.listPage(botId, {
      search,
      tag,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    });
  }

  /**
   * Returns one subscriber profile.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @returns {Promise<object>} Subscriber profile.
   */
  @Get(':telegramId')
  findOne(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('telegramId', ParseIntPipe) telegramId: number,
  ) {
    return this.crmService.findOne(botId, telegramId);
  }

  /**
   * Replaces tags and notes for a subscriber.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Subscriber Telegram id.
   * @param {object} body - `{ tags: string[], notes: string }`.
   * @returns {Promise<object>} Updated profile.
   */
  @Patch(':telegramId')
  updateTags(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('telegramId', ParseIntPipe) telegramId: number,
    @Body() body: { tags?: string[]; notes?: string },
  ) {
    return this.crmService.updateTags(botId, telegramId, body.tags ?? [], body.notes ?? '');
  }

  /**
   * Exports the audience as a CSV document.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<string>} CSV document.
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  exportCsv(@Param('botId', ParseIntPipe) botId: number): Promise<string> {
    return this.crmService.export(botId, 'csv');
  }

  /**
   * Exports the audience as a JSON document.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<string>} JSON document.
   */
  @Get('export/json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  exportJson(@Param('botId', ParseIntPipe) botId: number): Promise<string> {
    return this.crmService.export(botId, 'json');
  }

  /**
   * Returns the distinct tag inventory for filter chips.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<string[]>} Distinct tags.
   */
  @Get('tags/distinct')
  distinctTags(@Param('botId', ParseIntPipe) botId: number): Promise<string[]> {
    return this.crmService.distinctTags(botId);
  }
}
