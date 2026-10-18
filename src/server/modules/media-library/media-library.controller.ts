import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { MediaLibraryService } from './media-library.service';
import { CreateMediaAssetDto } from './dto/media-asset.dto';

/**
 * Shared media library endpoints for a bot.
 */
@Controller('bots/:botId/media')
export class MediaLibraryController {
  /**
   * @param {MediaLibraryService} service - Media library service.
   */
  constructor(private readonly service: MediaLibraryService) {}

  /**
   * Lists every library asset of the bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Asset rows.
   */
  @Get()
  list(@Param('botId') botId: string) {
    return this.service.list(botId);
  }

  /**
   * Adds an asset.
   * @param {number} botId - Owning bot id.
   * @param {CreateMediaAssetDto} body - name, source, value, kind, tags.
   * @returns {Promise<object>} Created asset row.
   */
  @Post()
  create(@Param('botId') botId: string, @Body() body: CreateMediaAssetDto) {
    return this.service.create(botId, body as unknown as Record<string, unknown>);
  }

  /**
   * Deletes an asset.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Asset id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.remove(botId, id);
  }
}
