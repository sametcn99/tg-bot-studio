import { Module } from '@nestjs/common';
import { InlineModeRuntime } from './inline-mode.runtime';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';

/**
 * Inline mode feature module: inline query answers for bots.
 */
@Module({
  imports: [AiAssistantModule],
  providers: [InlineModeRuntime],
  exports: [InlineModeRuntime],
})
export class InlineModeModule {}
