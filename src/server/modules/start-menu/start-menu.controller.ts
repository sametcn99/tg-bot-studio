import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
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
   * @returns {object[]} Ordered menu item rows.
   */
  @Get('bots/:botId/menu-items')
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.menuService.list(botId);
  }

  /**
   * Creates a start menu item.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - title, url, type, description, orderIndex.
   * @returns {object} Created menu item row.
   */
  @Post('bots/:botId/menu-items')
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.menuService.create(botId, body);
  }

  /**
   * Updates a start menu item.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Item identifier.
   * @param {Record<string, unknown>} body - Patch fields.
   * @returns {object} Updated menu item row.
   */
  @Patch('bots/:botId/menu-items/:id')
  update(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.menuService.update(botId, id, body);
  }

  /**
   * Deletes a start menu item.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Item identifier.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('bots/:botId/menu-items/:id')
  remove(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.menuService.remove(botId, id);
    return { success: true };
  }

  /**
   * Public click-tracking redirect used by menu inline buttons when the
   * operator configured a public base URL.
   * @param {number} id - Item identifier.
   * @param {Response} res - Express response used for the 302 redirect.
   * @returns {void}
   */
  @Public()
  @Get('go/:id')
  go(@Param('id', ParseIntPipe) id: number, @Res() res: Response): void {
    const url = this.menuService.trackClick(id);
    if (!url) {
      res.status(HttpStatus.NOT_FOUND).send('Link not found');
      return;
    }
    res.redirect(HttpStatus.FOUND, url);
  }
}
