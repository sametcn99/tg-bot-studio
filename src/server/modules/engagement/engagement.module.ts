import { Module } from '@nestjs/common';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';
import { QuizzesRuntime } from './quizzes.runtime';
import { ReactionsRuntime } from './reactions.runtime';

/**
 * Interactive Quizzes & Polls plus Reaction Analytics feature module.
 */
@Module({
  controllers: [EngagementController],
  providers: [EngagementService, QuizzesRuntime, ReactionsRuntime],
  exports: [EngagementService],
})
export class EngagementModule {}
