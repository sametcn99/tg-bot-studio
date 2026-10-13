import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

/**
 * Bot analytics endpoints powering the dashboard trend charts.
 */
@Controller('bots/:botId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Aggregated activity overview for the trailing window.
   * @param {number} botId - Bot identifier.
   * @param {string} [days] - Window length ('7' default, '30' supported).
   * @returns {Promise<object>} Totals and daily series.
   */
  @Get()
  overview(@Param('botId', ParseIntPipe) botId: number, @Query('days') days?: string) {
    return this.analytics.overview(botId, Number(days ?? 7) === 30 ? 30 : 7);
  }
}
