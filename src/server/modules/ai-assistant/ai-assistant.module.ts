import { Module } from '@nestjs/common';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';
import { AiAssistantRuntime } from './ai-assistant.runtime';

/**
 * AI Knowledge Assistant (OpenAI-compatible providers / Gemini) feature module.
 */
@Module({
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiAssistantRuntime],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
