import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { FlowsService } from './flows.service';

/**
 * Visual flow builder CRUD endpoints.
 */
@Controller('bots/:botId/flows')
export class FlowsController {
  /**
   * @param {FlowsService} service - Flow CRUD service.
   */
  constructor(private readonly service: FlowsService) {}

  /**
   * Lists flows with parsed graphs.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Flow rows.
   */
  @Get()
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Returns active-session counts per flow.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<Record<string, number>>} Session counts keyed by flow id.
   */
  @Get('session-counts')
  sessionCounts(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.sessionCounts(botId);
  }

  /**
   * Fetches one flow.
   */
  @Get(':id')
  findOne(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(botId, id);
  }

  /**
   * Creates a flow.
   */
  @Post()
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Updates a flow (resets its sessions).
   */
  @Put(':id')
  update(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(botId, id, body);
  }

  /**
   * Toggles a flow's active state.
   */
  @Patch(':id/active')
  setActive(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('value', ParseBoolPipe) value: boolean,
  ) {
    return this.service.setActive(botId, id, value);
  }

  /**
   * Deletes a flow.
   */
  @Delete(':id')
  remove(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(botId, id);
  }
}
