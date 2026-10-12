import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

/**
 * Liveness probe consumed by the Docker `HEALTHCHECK` and orchestrators.
 */
@Controller('health')
export class HealthController {
  /** Process start time used to compute uptime. */
  private readonly startedAt = Date.now();

  /**
   * Reports service liveness.
   * @returns {{status: string; uptimeSeconds: number; timestamp: string}} Health snapshot.
   */
  @Public()
  @Get()
  check(): { status: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
