import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
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
  getSettings(@Param('botId') botId: string) {
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
    @Param('botId') botId: string,
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
  sendTest(@Param('botId') botId: string) {
    return this.service.sendTestAlert(botId);
  }

  /**
   * Lists recent health events of the bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Events, newest first.
   */
  @Get('events')
  listEvents(@Param('botId') botId: string) {
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

/**
 * Studio-global operator alert transport (fallback bot for critical alerts
 * the sick bot itself cannot deliver).
 */
@Controller('settings/health-operator')
export class HealthOperatorController {
  /**
   * @param {HealthMonitorService} service - Health monitor service.
   */
  constructor(private readonly service: HealthMonitorService) {}

  /**
   * Reads the operator alert transport.
   * @returns {Promise<object>} `{botToken, chatId}` (token masked when set).
   */
  @Get()
  async get() {
    const settings = await this.service.getOperatorSettings();
    return {
      botToken: settings.botToken ? `${settings.botToken.slice(0, 6)}…` : '',
      chatId: settings.chatId,
      configured: Boolean(settings.botToken && settings.chatId),
    };
  }

  /**
   * Stores the operator alert transport.
   * @param {object} body - `{botToken, chatId}`.
   * @returns {Promise<object>} Stored values (token masked when set).
   */
  @Put()
  async update(@Body() body: { botToken?: string; chatId?: string }) {
    await this.service.updateOperatorSettings({
      botToken: String(body.botToken ?? ''),
      chatId: String(body.chatId ?? ''),
    });
    return this.get();
  }
}
