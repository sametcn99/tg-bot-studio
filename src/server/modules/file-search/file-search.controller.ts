import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { FileSearchService } from './file-search.service';

/**
 * Group file-search index endpoints for a bot (dashboard file list).
 */
@Controller('bots/:botId/file-index')
export class FileSearchController {
  /**
   * @param {FileSearchService} service - File search service.
   */
  constructor(private readonly service: FileSearchService) {}

  /**
   * Lists indexed files with optional filters.
   * @param {string} botId - Studio bot id.
   * @param {string} [chatId] - Chat id filter.
   * @param {string} [q] - Free-text filter.
   * @param {string} [kind] - Media kind filter.
   * @returns {Promise<object[]>} Index rows, newest first.
   */
  @Get()
  list(
    @Param('botId') botId: string,
    @Query('chatId') chatId?: string,
    @Query('q') q?: string,
    @Query('kind') kind?: string,
  ) {
    return this.service.list(botId, { chatId, q, kind });
  }

  /**
   * Deletes one indexed row.
   * @param {string} botId - Studio bot id.
   * @param {string} id - Row id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.remove(botId, id);
  }
}
