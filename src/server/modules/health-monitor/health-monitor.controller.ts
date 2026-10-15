import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { HealthMonitorService } from './health-monitor.service';

/**
 * Bot health monitoring endpoints: alert settings, events, and test alerts.
 */
@Controller('bots/:botId/health')
export class HealthMonitorController {
  /**
   * @param {HealthMonitorService} service - Health monitor service.
   */
  constructor(private readonly service: HealthMonitorService) {}

  /**
   * Reads alert settings.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object>} Settings payload.
   */
  @Get('alerts')
  getSettings(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.getSettings(botId);
  }

  /**
   * Updates alert settings.
   * @param {number} botId - Owning bot id.
   * @param {object} body - `{enabled, alertChatId}`.
   * @returns {Promise<object>} Effective settings.
   */
  @Put('alerts')
  updateSettings(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { enabled?: boolean; alertChatId?: string },
  ) {
    return this.service.updateSettings(botId, {
      enabled: Boolean(body.enabled),
      alertChatId: String(body.alertChatId ?? ''),
    });
  }

  /**
   * Sends a test alert.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object>} Delivery outcome.
   */
  @Post('alerts/test')
  sendTest(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.sendTestAlert(botId);
  }

  /**
   * Lists recent health events of the bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Events, newest first.
   */
  @Get('events')
  listEvents(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.listEvents(botId);
  }
}

/**
 * Studio-wide health event feed (all bots) for the overview page.
 */
@Controller('health-events')
export class HealthEventsController {
  /**
   * @param {HealthMonitorService} service - Health monitor service.
   */
  constructor(private readonly service: HealthMonitorService) {}

  /**
   * Lists recent events across every bot, optionally filtered by level.
   * @param {string} [level] - Optional level filter.
   * @returns {Promise<object[]>} Events, newest first.
   */
  @Get()
  list(@Query('level') level?: string) {
    void level;
    return this.service.listEvents();
  }
}
