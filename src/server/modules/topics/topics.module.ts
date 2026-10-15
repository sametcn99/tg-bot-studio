import { Module } from '@nestjs/common';
import { TopicsRuntime } from './topics.runtime';

/**
 * Topics feature module.
 */
@Module({
  providers: [TopicsRuntime],
})
export class TopicsModule {}
