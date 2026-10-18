import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StartMenuService } from './start-menu.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Start Menu item CRUD plus the public click-tracking redirect endpoint used
 * by menu inline buttons.
 */
@Controller()
export class StartMenuController {
  /**
   * @param {StartMenuService} menuService - Menu item CRUD service.
   */
  constructor(private readonly menuService: StartMenuService) {}

  /**
   * Lists all start menu items for a bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Ordered menu item rows.
   */
  @Get('bots/:botId/menu-items')
  list(@Param('botId') botId: string) {
    return this.menuService.list(botId);
  }

  /**
   * Creates a start menu item.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - title, url, type, description, orderIndex.
   * @returns {Promise<object>} Created menu item row.
   */
  @Post('bots/:botId/menu-items')
  create(@Param('botId') botId: string, @Body() body: Record<string, unknown>) {
    return this.menuService.create(botId, body);
  }

  /**
   * Updates a start menu item.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Item identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {Promise<object>} Updated menu item row.
   */
  @Patch('bots/:botId/menu-items/:id')
  update(
    @Param('botId') botId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.menuService.update(botId, id, body);
  }

  /**
   * Deletes a start menu item.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Item identifier.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete('bots/:botId/menu-items/:id')
  async remove(@Param('botId') botId: string, @Param('id') id: string) {
    await this.menuService.remove(botId, id);
    return { success: true };
  }

  /**
   * Public click-tracking redirect used by menu inline buttons when the
   * operator configured a public base URL.
   * @param {number} id - Item identifier.
   * @param {Response} res - Express response used for the 302 redirect.
   * @returns {Promise<void>}
   */
  @Public()
  @Get('go/:id')
  async go(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const url = await this.menuService.trackClick(id);
    if (!url) {
      res.status(HttpStatus.NOT_FOUND).send('Link not found');
      return;
    }
    res.redirect(HttpStatus.FOUND, url);
  }
}
