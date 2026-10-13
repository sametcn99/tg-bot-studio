import { Module } from '@nestjs/common';
import { MessageScoreController } from './message-score.controller';
import { MessageScoreService } from './message-score.service';
import { MessageScoreRuntime } from './message-score.runtime';

/**
 * Message Score & Activity Leaderboard feature module: group activity
 * scoring with rich, schedulable leaderboard postings.
 */
@Module({
  controllers: [MessageScoreController],
  providers: [MessageScoreService, MessageScoreRuntime],
})
export class MessageScoreModule {}
