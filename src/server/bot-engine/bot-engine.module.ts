import { Global, Module } from '@nestjs/common';
import { BotPoolService } from './bot-pool.service';
import { EngineHelpersService } from './engine-helpers.service';
import { ModuleHandlerRegistry } from './module-handler-registry';
import { PaymentEventsService } from './payment-events.service';
import { SimulatorService } from './simulator.service';

/**
 * Global bot engine module exporting the multi-bot runtime pool, the module
 * handler registry, the sandbox simulator, the Stars payment event bus, and
 * shared audience helpers to every feature module.
 */
@Global()
@Module({
  providers: [
    BotPoolService,
    ModuleHandlerRegistry,
    EngineHelpersService,
    SimulatorService,
    PaymentEventsService,
  ],
  exports: [
    BotPoolService,
    ModuleHandlerRegistry,
    EngineHelpersService,
    SimulatorService,
    PaymentEventsService,
  ],
})
export class BotEngineModule {}
