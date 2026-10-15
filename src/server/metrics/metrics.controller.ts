import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scraper endpoint. Rendered with `@Res()` so the global
 * `{success, data}` envelope interceptor does not wrap the exposition text.
 */
@Controller('metrics')
export class MetricsController {
  /**
   * @param {MetricsService} metrics - Metric collector and renderer.
   */
  constructor(private readonly metrics: MetricsService) {}

  /**
   * Serves the current metrics snapshot in Prometheus text format.
   * @param {Response} res - Express response written directly.
   * @returns {Promise<void>} Resolves once the payload is sent.
   */
  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    const body = await this.metrics.render();
    res.type('text/plain; version=0.0.4; charset=utf-8').send(body);
  }
}
