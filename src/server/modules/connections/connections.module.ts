import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

/**
 * Chat Connections feature module: the shared group/channel address book.
 * Per-chat module overrides live on the chat-settings controller in the
 * bots module (keyed by Telegram chat id, not connection id).
 */
@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
