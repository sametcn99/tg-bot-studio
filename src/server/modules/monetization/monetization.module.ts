import { Module } from '@nestjs/common';
import { MonetizationController } from './monetization.controller';
import { MonetizationService } from './monetization.service';

/**
 * Paid Media Paywall and VIP Channel Subscriptions feature module. Sends are
 * guarded by the runtime toggle of the respective module keys.
 */
@Module({
  controllers: [MonetizationController],
  providers: [MonetizationService],
  exports: [MonetizationService],
})
export class MonetizationModule {}
