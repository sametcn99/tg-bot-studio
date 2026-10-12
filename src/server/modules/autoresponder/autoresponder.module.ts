import { Module } from '@nestjs/common';
import { AutoresponderController } from './autoresponder.controller';
import { AutoresponderService } from './autoresponder.service';
import { AutoresponderRuntime } from './autoresponder.runtime';

/**
 * Custom Commands & Auto-Responder feature module.
 */
@Module({
  controllers: [AutoresponderController],
  providers: [AutoresponderService, AutoresponderRuntime],
  exports: [AutoresponderService],
})
export class AutoresponderModule {}
