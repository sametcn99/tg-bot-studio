import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';

/**
 * Enterprise Broadcast Engine feature module. The module has no bot
 * middleware; its runtime toggle gates the queue execution.
 */
@Module({
  controllers: [BroadcastController],
  providers: [BroadcastService],
  exports: [BroadcastService],
})
export class BroadcastModule {}
