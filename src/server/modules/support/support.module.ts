import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportRuntime } from './support.runtime';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';

/**
 * Forum Topics Support Desk (Livegram) feature module.
 */
@Module({
  imports: [AiAssistantModule],
  controllers: [SupportController],
  providers: [SupportRuntime],
})
export class SupportModule {}
