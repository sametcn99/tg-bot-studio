import { Global, Module } from '@nestjs/common';
import { BotPoolService } from './bot-pool.service';
import { EngineHelpersService } from './engine-helpers.service';
import { ModuleHandlerRegistry } from './module-handler-registry';
import { PaymentEventsService } from './payment-events.service';
import { SimulatorService } from './simulator.service';
import { ChatSettingsService } from './chat-settings.service';
import { AdminGateService } from './admin-gate.service';
import { RestrictionsService } from './restrictions.service';
import { AdminLogService } from './admin-log.service';
import { BotI18nService } from './bot-i18n.service';
import { CommandAccessService } from './command-access.service';

/**
 * Global bot engine module exporting the multi-bot runtime pool, the module
 * handler registry, the sandbox simulator, the Stars payment event bus, and
 * shared audience helpers to every feature module — plus the reference-parity
 * shared services: per-chat settings, admin gate, restrictions executor,
 * admin log bus, and bot-reply i18n.
 */
@Global()
@Module({
  providers: [
    BotPoolService,
    ModuleHandlerRegistry,
    EngineHelpersService,
    SimulatorService,
    PaymentEventsService,
    ChatSettingsService,
    AdminGateService,
    RestrictionsService,
    AdminLogService,
    BotI18nService,
    CommandAccessService,
  ],
  exports: [
    BotPoolService,
    ModuleHandlerRegistry,
    EngineHelpersService,
    SimulatorService,
    PaymentEventsService,
    ChatSettingsService,
    AdminGateService,
    RestrictionsService,
    AdminLogService,
    BotI18nService,
    CommandAccessService,
  ],
})
export class BotEngineModule {}
