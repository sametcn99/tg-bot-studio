import { Module } from '@nestjs/common';
import { WelcomeRuntime } from './welcome.runtime';

/**
 * Group Welcome & Clean Chat feature module (runtime only; configuration is
 * managed through the generic module config API).
 */
@Module({
  providers: [WelcomeRuntime],
})
export class WelcomeModule {}
