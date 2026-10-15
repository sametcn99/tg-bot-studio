import { Module } from '@nestjs/common';
import { FederationController } from './federation.controller';
import { FederationRuntime } from './federation.runtime';
import { FederationService } from './federation.service';

/**
 * reference-parity ban federations: shared ban lists across every joined chat
 * of every studio bot, with subscriptions, imports, and passive enforcement.
 */
@Module({
  controllers: [FederationController],
  providers: [FederationRuntime, FederationService],
})
export class FederationModule {}
