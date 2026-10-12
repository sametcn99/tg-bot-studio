import { Global, Module } from '@nestjs/common';
import { BotPoolService } from './bot-pool.service';
import { EngineHelpersService } from './engine-helpers.service';
import { ModuleHandlerRegistry } from './module-handler-registry';

/**
 * Global bot engine module exporting the multi-bot runtime pool, the module
 * handler registry, and shared audience helpers to every feature module.
 */
@Global()
@Module({
  providers: [BotPoolService, ModuleHandlerRegistry, EngineHelpersService],
  exports: [BotPoolService, ModuleHandlerRegistry, EngineHelpersService],
})
export class BotEngineModule {}
