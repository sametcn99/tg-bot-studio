import { Module } from '@nestjs/common';
import { BusinessRuntime } from './business.runtime';

/**
 * Telegram Business Secretary feature module (runtime only; configuration is
 * managed through the generic module config API).
 */
@Module({
  providers: [BusinessRuntime],
})
export class BusinessModule {}
