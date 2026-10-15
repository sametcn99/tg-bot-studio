import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections.controller';
import { ConnectionsSettingsController } from './connections-settings.controller';
import { ConnectionsService } from './connections.service';

/**
 * Chat Connections feature module: the shared group/channel address book and
 * the per-group module settings editor.
 */
@Module({
  controllers: [ConnectionsController, ConnectionsSettingsController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
