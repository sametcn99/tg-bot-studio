import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { FlowsService } from './flows.service';
import { SaveFlowDto } from './dto/flow.dto';

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
  list(@Param('botId') botId: string) {
    return this.service.list(botId);
  }

  /**
   * Returns active-session counts per flow.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<Record<string, number>>} Session counts keyed by flow id.
   */
  @Get('session-counts')
  sessionCounts(@Param('botId') botId: string) {
    return this.service.sessionCounts(botId);
  }

  /**
   * Fetches one flow.
   */
  @Get(':id')
  findOne(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.findOne(botId, id);
  }

  /**
   * Creates a flow.
   */
  @Post()
  create(@Param('botId') botId: string, @Body() body: SaveFlowDto) {
    return this.service.create(botId, body as unknown as Record<string, unknown>);
  }

  /**
   * Updates a flow (resets its sessions).
   */
  @Put(':id')
  update(@Param('botId') botId: string, @Param('id') id: string, @Body() body: SaveFlowDto) {
    return this.service.update(botId, id, body as unknown as Record<string, unknown>);
  }

  /**
   * Toggles a flow's active state.
   */
  @Patch(':id/active')
  setActive(
    @Param('botId') botId: string,
    @Param('id') id: string,
    @Query('value', ParseBoolPipe) value: boolean,
  ) {
    return this.service.setActive(botId, id, value);
  }

  /**
   * Deletes a flow.
   */
  @Delete(':id')
  remove(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.remove(botId, id);
  }
}
