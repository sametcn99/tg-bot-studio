import { Module } from '@nestjs/common';
import { AdminLogRuntime } from './admin-log.runtime';

/**
 * AdminLog feature module.
 */
@Module({
  providers: [AdminLogRuntime],
})
export class AdminLogModule {}
