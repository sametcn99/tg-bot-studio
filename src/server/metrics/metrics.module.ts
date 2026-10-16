import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { resolveJwtSecret } from '../auth/auth-defaults';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Prometheus metrics module exposing `/api/metrics` for scraper collection.
 * The scrape endpoint is auth-gated: `METRICS_BEARER_TOKEN` for scrapers or a
 * valid dashboard session.
 */
@Module({
  imports: [AuthModule, JwtModule.register({ secret: resolveJwtSecret() })],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
