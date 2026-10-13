import { Module } from '@nestjs/common';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AiAssistantModule } from '../modules/ai-assistant/ai-assistant.module';

/**
 * Bot registration, module toggle, and analytics feature module.
 */
@Module({
  imports: [AiAssistantModule],
  controllers: [BotsController, AnalyticsController],
  providers: [BotsService, AnalyticsService],
  exports: [BotsService],
})
export class BotsModule {}
