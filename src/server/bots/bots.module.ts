import { Module } from '@nestjs/common';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';
import { AiAssistantModule } from '../modules/ai-assistant/ai-assistant.module';

/**
 * Bot registration and module toggle feature module.
 */
@Module({
  imports: [AiAssistantModule],
  controllers: [BotsController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
